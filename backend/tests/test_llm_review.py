import json

from app.services.llm_review import (
    PROMPT_VERSION,
    build_prompt,
    fallback_suggestion,
    generate_llm_review,
)

CONTEXT = {
    'session_id': '11111111-1111-1111-1111-111111111111',
    'course_code': 'CSC401',
    'matric_number': '22/01DL068',
    'session_start': '2026-11-24T08:00:00+00:00',
    'session_end': '2026-11-24T09:00:00+00:00',
    'policy_reason': 'Evidence arrived late or needs review.',
    'evidence': {
        'check_in_count': 1,
        'checkpoint_count': 1,
        'checkpoint_ok': True,
        'check_out_ok': False,
        'venue_signal_count': 0,
        'venue_continuity_ok': False,
        'batch_scan_ok': False,
        'end_ok': False,
        'review_reasons': ['Event arrived after the grace window.'],
    },
    'exemption_reason': None,
}

VALID_LLM_RESPONSE = {
    'recommended_status': 'present',
    'confidence': 0.82,
    'reason_summary': 'Signed check-in and one checkpoint support attendance.',
    'entities': {
        'course_code': 'CSC401',
        'session_id': '11111111-1111-1111-1111-111111111111',
        'event_types': ['check_in', 'checkpoint'],
        'signals': ['qr'],
        'issues': [],
        'route_to': 'lecturer',
    },
    'draft_message': 'Your attendance has been reviewed and approved.',
}


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {
            'id': 'resp-1',
            'usage': {'total_tokens': 42},
            'choices': [{'message': {'content': self.content}}],
        }


def test_build_prompt_is_parseable_json():
    parsed = json.loads(build_prompt(CONTEXT))
    assert parsed['course_code'] == 'CSC401'
    assert parsed['matric_number'] == '22/01DL068'


def test_fallback_without_check_in_is_absent():
    context = dict(CONTEXT, evidence={'check_in_count': 0, 'review_reasons': []})
    suggestion = fallback_suggestion(context)
    assert suggestion.recommended_status == 'absent'
    assert suggestion.confidence == 0.55


def test_fallback_keeps_late_evidence_pending_review():
    suggestion = fallback_suggestion(CONTEXT)
    assert suggestion.recommended_status == 'pending_review'
    assert suggestion.entities.route_to == 'lecturer'
    assert 'human review' in suggestion.reason_summary


def test_generate_uses_fallback_when_api_key_is_missing(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    suggestion, meta = generate_llm_review(CONTEXT)
    assert meta['fallback_used'] is True
    assert meta['prompt_version'] == PROMPT_VERSION
    assert meta['model'] == 'rule-based-fallback'


def test_generate_accepts_valid_json_from_llm(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    monkeypatch.setattr(
        'app.services.llm_review.requests.post',
        lambda *args, **kwargs: FakeResponse(json.dumps(VALID_LLM_RESPONSE)),
    )

    suggestion, meta = generate_llm_review(CONTEXT)
    assert suggestion.recommended_status == 'present'
    assert suggestion.entities.route_to == 'lecturer'
    assert meta['fallback_used'] is False
    assert meta['model'] == 'test-model'


def test_generate_falls_back_on_invalid_llm_json(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setattr(
        'app.services.llm_review.requests.post',
        lambda *args, **kwargs: FakeResponse('{"recommended_status": "present"}'),
    )

    suggestion, meta = generate_llm_review(CONTEXT)
    assert suggestion.recommended_status == 'pending_review'
    assert meta['fallback_used'] is True
    assert 'ValidationError' in meta['fallback_reason']
