import { useRef, useEffect, useState } from 'react'

/**
 * NDPRConsent — Nigeria Data Protection Regulation 2019 Consent Modal
 *
 * Legal requirements enforced:
 *  1. Consent text must be scrolled to bottom before checkbox activates
 *  2. Explicit opt-in checkbox required (no pre-checked state)
 *  3. Records timestamp and version of consent given
 *  4. Informs subject of: purpose, retention, right to erasure, data minimisation
 */
export default function NDPRConsent({ onAccept, onDecline }) {
  const scrollRef = useRef(null)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [checked, setChecked] = useState(false)

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    if (atBottom) setScrolledToBottom(true)
  }

  function handleAccept() {
    if (!checked) return
    onAccept({
      consent_given: true,
      consent_version: '1.0',
      consent_timestamp: new Date().toISOString(),
    })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 560, maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="modal-header" style={{ marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warning)', textTransform: 'uppercase', marginBottom: '4px' }}>
              ⚖️ Legal Consent Required
            </div>
            <h3 style={{ margin: 0 }}>Nigeria Data Protection Regulation 2019</h3>
            <p className="text-sm text-muted" style={{ marginTop: '4px' }}>
              Please read the full notice below before proceeding.
            </p>
          </div>
        </div>

        {/* Scrollable consent body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: 'auto', padding: '20px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            fontSize: '13px', lineHeight: '1.8', color: 'var(--text-secondary)',
            marginBottom: '20px', maxHeight: '320px',
          }}
        >
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Biometric Data Processing Notice</h4>
          <p>This system — <strong style={{ color: 'var(--text-primary)' }}>FaceAttend</strong>, operated by the Department of Computer Science, University of Ilorin — intends to process your biometric facial data for the purpose of automated attendance tracking in accordance with the <strong style={{ color: 'var(--text-primary)' }}>Nigeria Data Protection Regulation (NDPR) 2019</strong> and the Nigeria Data Protection Act 2023.</p>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>1. What We Collect</h5>
          <p>We collect a <strong style={{ color: 'var(--text-primary)' }}>mathematical vector representation</strong> (embedding) derived from your facial geometry. <strong style={{ color: 'var(--text-primary)' }}>No raw facial image frames are stored, uploaded, or transmitted</strong> at any point. All facial processing occurs entirely on your device (browser-native, on-device inference). The embedding is a one-way numeric transformation and cannot be used to reconstruct your facial image.</p>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>2. Purpose of Processing</h5>
          <p>Your biometric embedding is used exclusively to verify your identity during scheduled attendance sessions for the course(s) you are enrolled in. It will not be used for any other purpose without a separate, explicit consent.</p>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>3. Data Storage & Retention</h5>
          <p>Your embedding is stored in a secured institutional database accessible only to authorised system administrators. Your data will be <strong style={{ color: 'var(--text-primary)' }}>deleted within 30 days of the end of the academic session</strong> in which you are enrolled, in accordance with the NDPR data minimisation principle.</p>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>4. Your Rights (NDPR Section 3.1)</h5>
          <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
            <li><strong style={{ color: 'var(--text-primary)' }}>Right of Access</strong>: You may request a copy of the data held about you at any time.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>Right to Erasure</strong>: You may request deletion of your biometric data by contacting the Department Data Controller.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>Right to Object</strong>: You may object to biometric-based attendance. Alternative attendance verification methods are available upon request to your lecturer.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>Right to Portability</strong>: You may request your data in a machine-readable format.</li>
          </ul>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>5. Liveness Detection</h5>
          <p>The system uses a dual-layer liveness detection pipeline (blink challenge + passive photoplethysmography analysis) to prevent spoofing attacks. This processing occurs entirely on-device. No biometric signal data is uploaded.</p>

          <h5 style={{ color: 'var(--text-primary)', marginTop: '16px', marginBottom: '8px' }}>6. Data Controller</h5>
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>Department of Computer Science</strong><br />
            University of Ilorin, Kwara State, Nigeria<br />
            Data Protection Officer Contact: dpo@unilorin.edu.ng
          </p>

          <p style={{ marginTop: '16px', padding: '12px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', borderLeft: '3px solid var(--warning)', color: 'var(--warning)' }}>
            ⚠️ Consent is voluntary. Withholding consent will not affect your academic standing. Alternative attendance verification remains available.
          </p>

          <p style={{ marginTop: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
            NDPR Consent Form v1.0 · Issued by Unilorin Dept. of Computer Science · {new Date().getFullYear()}
          </p>
        </div>

        {/* Scroll-to-bottom indicator */}
        {!scrolledToBottom && (
          <div style={{ textAlign: 'center', marginBottom: '12px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <span>↓</span> Scroll to the bottom to enable the checkbox
          </div>
        )}

        {/* Consent checkbox */}
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: '12px',
          cursor: scrolledToBottom ? 'pointer' : 'not-allowed',
          opacity: scrolledToBottom ? 1 : 0.4,
          marginBottom: '20px', padding: '12px',
          background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
          border: '1px solid var(--border-subtle)',
          transition: 'opacity 0.3s',
          pointerEvents: scrolledToBottom ? 'auto' : 'none',
        }}>
          <input
            id="ndpr-consent-checkbox"
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            disabled={!scrolledToBottom}
            style={{ marginTop: '2px', accentColor: 'var(--brand-mid)', width: '16px', height: '16px', flexShrink: 0 }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            I have read and understood this notice. I freely and voluntarily consent to the processing of my biometric facial data by the Department of Computer Science, University of Ilorin, solely for attendance verification as described above. I understand I may withdraw this consent at any time.
          </span>
        </label>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            id="btn-ndpr-decline"
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onDecline}
          >
            Decline
          </button>
          <button
            id="btn-ndpr-accept"
            className="btn btn-primary"
            style={{ flex: 2 }}
            disabled={!checked}
            onClick={handleAccept}
          >
            I Consent — Continue
          </button>
        </div>
      </div>
    </div>
  )
}
