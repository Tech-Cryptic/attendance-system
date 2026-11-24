"""Unit tests for the presence policy engine."""

from datetime import datetime, timedelta, timezone

from app.services.presence_policy import evaluate_presence


START = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
END = START + timedelta(minutes=60)


def event(event_type, at, source='qr', **extra):
    base = {
        'event_type': event_type,
        'source': source,
        'observed_at': at,
        'accepted': True,
        'review_reason': None,
    }
    base.update(extra)
    return base


def policy(**overrides):
    base = {
        'required_checkpoints': 1,
        'grace_minutes': 5,
        'venue_lat': 8.4966,
        'venue_lon': 4.4725,
        'venue_radius_m': 100,
        'venue_ssids': ['UNILORIN-CLASS'],
        'venue_beacon_ids': ['room-101'],
    }
    base.update(overrides)
    return base


def evaluate(events, **overrides):
    return evaluate_presence(
        policy(**overrides.pop('policy_overrides', {})),
        events,
        session_start=START,
        session_end=END,
        now=END + timedelta(minutes=1),
        **overrides,
    )


def test_qr_checkpoints_and_checkout_make_present():
    events = [
        event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr'),
        event('checkpoint', START + timedelta(minutes=20), qr_nonce='cp-1'),
        event('checkpoint', START + timedelta(minutes=40), qr_nonce='cp-2'),
        event('check_out', END - timedelta(minutes=1), qr_nonce='out'),
    ]
    result = evaluate(events, policy_overrides={'required_checkpoints': 2})
    assert result['status'] == 'present'
    assert result['counts_as_present'] is True
    assert result['evidence']['checkpoint_ok'] is True


def test_explicit_leave_invalidates_attendance():
    events = [
        event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr'),
        event('leave', START + timedelta(minutes=15), source='client'),
        event('check_out', END - timedelta(minutes=1), qr_nonce='out'),
    ]
    result = evaluate(events)
    assert result['status'] == 'left_early'
    assert result['counts_as_present'] is False


def test_checkin_without_continuity_goes_to_review_not_failure():
    events = [event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr')]
    result = evaluate(events)
    assert result['status'] == 'pending_review'
    assert result['counts_as_present'] is False


def test_gps_spanning_lecture_can_replace_checkpoints():
    events = [
        event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr'),
        event('venue_signal', START + timedelta(minutes=2), source='gps',
              latitude=8.49661, longitude=4.47251, accuracy_m=20),
        event('venue_signal', END - timedelta(minutes=2), source='gps',
              latitude=8.49662, longitude=4.47252, accuracy_m=20),
    ]
    result = evaluate(events, policy_overrides={'required_checkpoints': 3})
    assert result['status'] == 'present'
    assert result['evidence']['venue_continuity_ok'] is True


def test_final_out_of_venue_signal_means_left_early():
    events = [
        event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr'),
        event('venue_signal', END - timedelta(minutes=5), source='gps',
              latitude=9.05, longitude=4.47, accuracy_m=20),
    ]
    result = evaluate(events)
    assert result['status'] == 'left_early'


def test_manual_exemption_counts_as_present_and_is_audited():
    exemption = {'active': True, 'counts_as_present': True, 'reason': 'Phone battery died'}
    result = evaluate([], exemption=exemption)
    assert result['status'] == 'exempted'
    assert result['counts_as_present'] is True
    assert result['evidence']['exemption_reason'] == 'Phone battery died'


def test_late_event_goes_to_review_even_with_complete_qr():
    events = [
        event('check_in', START + timedelta(minutes=1), qr_nonce='session-qr'),
        event('checkpoint', START + timedelta(minutes=20), qr_nonce='cp-1'),
        event('check_out', END - timedelta(minutes=1), qr_nonce='out',
              review_reason='Event arrived after the grace window.'),
    ]
    result = evaluate(events)
    assert result['status'] == 'pending_review'
    assert 'Event arrived after the grace window.' in result['evidence']['review_reasons']
