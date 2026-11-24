"""Advisory LLM review for evidence the policy engine cannot resolve."""

import json
import os
from typing import Any

import requests

from app.models.presence import LLMReviewSuggestion

PROMPT_VERSION = 'presence-review-v1'

SYSTEM_PROMPT = """You are an attendance review assistant at a university.
You are advisory only. You must never claim that you made a final decision.

Return ONLY a JSON object with exactly these keys:
- recommended_status: one of present, left_early, absent, exempted, pending_review
- confidence: number from 0 to 1
- reason_summary: one or two sentences explaining the recommendation
- entities: object with keys course_code, session_id, event_types, signals, issues, route_to
- draft_message: a polite, short message to the student explaining the next step

Rules:
- Treat QR checkpoints as stronger evidence than GPS, Wi-Fi, or BLE.
- Treat late or conflicting evidence conservatively; prefer pending_review.
- If there is no signed QR check-in, recommend absent or pending_review only.
- If a manual exemption was claimed, recommend exempted.
- route_to must be lecturer, admin, or student.
- Do not invent facts that are absent from the evidence payload.
"""


def build_prompt(context: dict[str, Any]) -> str:
    """Serialise the review context into a compact, auditable prompt body."""
    return json.dumps(context, indent=2, sort_keys=True, default=str)


def _extract_json(text: str) -> dict:
    """Parse JSON from a model response, tolerating common markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith('```'):
        parts = cleaned.split('```')
        if len(parts) >= 3:
            cleaned = parts[1].strip()
    if cleaned.lower().startswith('json'):
        cleaned = cleaned[4:].strip()

    data = json.loads(cleaned)
    if isinstance(data, dict) and isinstance(data.get('suggestion'), dict):
        data = data['suggestion']
    if not isinstance(data, dict):
        raise ValueError('LLM response was not a JSON object.')
    return data


def fallback_suggestion(context: dict[str, Any]) -> LLMReviewSuggestion:
    """
    Deterministic review used when the LLM is unavailable or invalid.

    A model failure must not produce a failing attendance outcome.
    """
    evidence = context.get('evidence') or {}
    reasons = [str(r) for r in (evidence.get('review_reasons') or []) if r]
    check_ins = int(evidence.get('check_in_count') or 0)
    checkpoint_count = int(evidence.get('checkpoint_count') or 0)
    end_ok = bool(evidence.get('end_ok'))
    route_to = 'admin' if len(reasons) > 1 else 'lecturer'

    if check_ins == 0:
        status = 'pending_review' if reasons else 'absent'
        confidence = 0.35 if reasons else 0.55
        summary = 'No accepted signed QR check-in was recorded for this session.'
    elif reasons:
        status = 'pending_review'
        confidence = 0.30
        summary = 'Evidence was recorded but flagged as late or conflicting; human review is required.'
    elif checkpoint_count > 0 and end_ok:
        status = 'present'
        confidence = 0.70
        summary = 'Check-in, checkpoint, and end-of-session evidence are present.'
    else:
        status = 'pending_review'
        confidence = 0.40
        summary = 'Evidence is incomplete and does not satisfy the full-session policy.'

    return LLMReviewSuggestion.model_validate({
        'recommended_status': status,
        'confidence': confidence,
        'reason_summary': summary,
        'entities': {
            'course_code': context.get('course_code'),
            'session_id': context.get('session_id'),
            'event_types': ['check_in', 'checkpoint', 'check_out', 'venue_signal'],
            'signals': ['qr'] if check_ins else [],
            'issues': reasons,
            'route_to': route_to,
        },
        'draft_message': (
            'Your attendance for this session is under review. '
            'Your lecturer will confirm the outcome shortly.'
        ),
    })


def generate_llm_review(context: dict[str, Any]) -> tuple[LLMReviewSuggestion, dict[str, Any]]:
    """
    Call an OpenAI-compatible chat completions API and validate its output.

    Returns the suggestion plus non-sensitive metadata for the audit log. The
    raw prompt is never logged because it contains student evidence.
    """
    api_key = os.getenv('OPENAI_API_KEY')
    base_url = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
    model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')

    if not api_key:
        suggestion = fallback_suggestion(context)
        return suggestion, {
            'model': 'rule-based-fallback',
            'prompt_version': PROMPT_VERSION,
            'fallback_used': True,
            'fallback_reason': 'OPENAI_API_KEY is not configured.',
            'raw_response': None,
        }

    try:
        response = requests.post(
            f'{base_url}/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'temperature': 0.1,
                'response_format': {'type': 'json_object'},
                'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': build_prompt(context)},
                ],
            },
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload['choices'][0]['message']['content']
        suggestion = LLMReviewSuggestion.model_validate(_extract_json(content))

        return suggestion, {
            'model': model,
            'prompt_version': PROMPT_VERSION,
            'fallback_used': False,
            'fallback_reason': None,
            'raw_response': {
                'response_id': payload.get('id'),
                'usage': payload.get('usage'),
            },
        }
    except Exception as exc:
        suggestion = fallback_suggestion(context)
        return suggestion, {
            'model': 'rule-based-fallback',
            'prompt_version': PROMPT_VERSION,
            'fallback_used': True,
            'fallback_reason': f'{type(exc).__name__}: {str(exc)[:200]}',
            'raw_response': None,
        }
