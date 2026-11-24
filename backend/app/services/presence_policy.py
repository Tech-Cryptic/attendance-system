"""Pure policy evaluation for presence evidence.

Devices record evidence; the server resolves it to one of `present`,
`left_early`, `absent`, `exempted`, or `pending_review`.
"""

from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Optional


PRESENT = 'present'
LEFT_EARLY = 'left_early'
ABSENT = 'absent'
EXEMPTED = 'exempted'
PENDING_REVIEW = 'pending_review'


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise naive datetimes to UTC so comparisons never raise."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    r = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(a))


def signal_within_venue(event: dict, policy: dict) -> Optional[bool]:
    """
    Return True/False/None for a venue signal.

    None means "no usable configured reference", not "present". This distinction
    prevents a student with an unconfigured campus from being failed merely
    because they had no Wi-Fi/BLE signal configured.
    """
    answers = []

    if event.get('source') == 'gps' and event.get('latitude') is not None and event.get('longitude') is not None:
        if policy.get('venue_lat') is not None and policy.get('venue_lon') is not None:
            distance = haversine_m(
                float(policy['venue_lat']), float(policy['venue_lon']),
                float(event['latitude']), float(event['longitude']),
            )
            # Accuracy is added to the radius: a 200m-accurate fix should not
            # be treated as proof that the student crossed the boundary.
            tolerance = float(policy.get('venue_radius_m') or 100) + float(event.get('accuracy_m') or 0)
            answers.append(distance <= tolerance)

    configured_ssids = {str(v).lower() for v in (policy.get('venue_ssids') or [])}
    if event.get('source') == 'wifi' and configured_ssids:
        observed = {str(event.get('ssid') or '').lower(), str(event.get('bssid') or '').lower()}
        answers.append(bool(observed & configured_ssids))

    configured_beacons = {str(v).lower() for v in (policy.get('venue_beacon_ids') or [])}
    if event.get('source') == 'ble' and configured_beacons:
        beacon = str(event.get('beacon_id') or '').lower()
        answers.append(beacon in configured_beacons)

    if not answers:
        return None
    return True if True in answers else False


def _accepted(event: dict) -> bool:
    # Records written by the API always have `accepted`. Tests and internal
    # callers may omit it, in which case the event is assumed accepted.
    return bool(event.get('accepted', True))


def evaluate_presence(
    policy: dict,
    events: list[dict],
    *,
    session_start: datetime,
    session_end: datetime,
    exemption: Optional[dict] = None,
    batch_scanned_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> dict:
    """Turn accepted evidence into one attendance outcome."""
    now = _as_utc(now) or datetime.now(timezone.utc)
    session_start = _as_utc(session_start)
    session_end = _as_utc(session_end)
    batch_scanned_at = _as_utc(batch_scanned_at)

    if exemption and exemption.get('active', True) and exemption.get('counts_as_present', True):
        return {
            'status': EXEMPTED,
            'counts_as_present': True,
            'reason': 'Lecturer-approved manual exemption claimed by student.',
            'evidence': {'exemption_reason': exemption.get('reason')},
        }

    accepted = [e for e in events if _accepted(e)]
    review_reasons = [e.get('review_reason') for e in events if e.get('review_reason')]

    check_ins = [e for e in accepted if e.get('event_type') == 'check_in' and e.get('source') == 'qr']
    if not check_ins:
        status = PENDING_REVIEW if review_reasons or accepted else ABSENT
        return {
            'status': status,
            'counts_as_present': False,
            'reason': 'No accepted signed QR check-in.' if not review_reasons else 'Evidence arrived late or needs review.',
            'evidence': {'check_in_count': 0, 'review_reasons': review_reasons},
        }

    sorted_events = sorted(
        accepted,
        key=lambda e: _as_utc(e.get('observed_at')) or now,
    )

    checkpoint_nonces = {
        e.get('qr_nonce') for e in sorted_events
        if e.get('event_type') == 'checkpoint' and e.get('source') == 'qr' and e.get('qr_nonce')
    }
    checkpoint_ok = len(checkpoint_nonces) >= int(policy.get('required_checkpoints') or 0)
    check_out_ok = any(
        e.get('event_type') == 'check_out' and e.get('source') == 'qr'
        for e in sorted_events
    )

    venue_checks = []
    for e in sorted_events:
        if e.get('event_type') != 'venue_signal':
            continue
        result = signal_within_venue(e, policy)
        if result is not None:
            venue_checks.append((_as_utc(e.get('observed_at')) or now, result))

    inside_times = [t for t, inside in venue_checks if inside]
    continuity_ok = False
    if policy.get('venue_lat') is not None and len(inside_times) >= 2:
        grace = int(policy.get('grace_minutes') or 0)
        # Being seen near both the start and the end is stronger evidence than
        # simply having two mid-class pings.
        early = min(inside_times) <= session_start + timedelta(minutes=grace)
        late = max(inside_times) >= session_end - timedelta(minutes=grace)
        continuity_ok = early and late

    batch_ok = bool(
        batch_scanned_at and
        batch_scanned_at > session_start + (session_end - session_start) / 2
    )
    end_ok = check_out_ok or continuity_ok or batch_ok

    left_event = any(e.get('event_type') == 'leave' for e in sorted_events)
    last_venue_outside = bool(venue_checks) and not venue_checks[-1][1]
    left = left_event or (last_venue_outside and not continuity_ok)

    continuity = checkpoint_ok or continuity_ok

    if left:
        status, reason = LEFT_EARLY, 'Student left the venue or sent an explicit leave event.'
    elif continuity and end_ok and not review_reasons:
        status, reason = PRESENT, 'Presence evidence satisfies the full-session policy.'
    else:
        status = PENDING_REVIEW
        reason = 'Presence evidence is incomplete, late, or conflicting; lecturer review required.'

    return {
        'status': status,
        'counts_as_present': status in (PRESENT, EXEMPTED),
        'reason': reason,
        'evidence': {
            'check_in_count': len(check_ins),
            'checkpoint_count': len(checkpoint_nonces),
            'checkpoint_ok': checkpoint_ok,
            'check_out_ok': check_out_ok,
            'venue_signal_count': len(venue_checks),
            'venue_continuity_ok': continuity_ok,
            'batch_scan_ok': batch_ok,
            'end_ok': end_ok,
            'review_reasons': review_reasons,
            'evaluated_at': now.isoformat(),
        },
    }
