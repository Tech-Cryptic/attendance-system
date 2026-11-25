import { useRef, useState } from 'react'

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
      <div
        className="modal-box stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ndpr-consent-title"
      >
        <div className="modal-header">
          <div className="stack-sm">
            <span className="eyebrow">Legal consent required</span>
            <h3 id="ndpr-consent-title" className="panel-title">Nigeria Data Protection Regulation 2019</h3>
            <p className="text-sm text-muted">Please read the full notice below before proceeding.</p>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label="Biometric data processing notice"
          className="panel stack-sm"
          style={{ flex: '1 1 auto', minHeight: 0, maxHeight: '320px', overflowY: 'auto' }}
        >
          <section className="stack-sm">
            <h4 className="panel-title">Biometric Data Processing Notice</h4>
            <p>
              This system, <strong>FaceAttend</strong>, operated by the Department of Computer Science,
              University of Ilorin, intends to process your biometric facial data for the purpose of
              automated attendance tracking in accordance with the{' '}
              <strong>Nigeria Data Protection Regulation (NDPR) 2019</strong> and the Nigeria Data
              Protection Act 2023.
            </p>
          </section>

          <section className="stack-sm">
            <h5>1. What We Collect</h5>
            <p>
              We collect a <strong>mathematical vector representation</strong> (embedding) derived from
              your facial geometry. <strong>No raw facial image frames are stored, uploaded, or
              transmitted</strong> at any point. All facial processing occurs entirely on your device
              (browser-native, on-device inference). The embedding is a one-way numeric transformation
              and cannot be used to reconstruct your facial image.
            </p>
          </section>

          <section className="stack-sm">
            <h5>2. Purpose of Processing</h5>
            <p>
              Your biometric embedding is used exclusively to verify your identity during scheduled
              attendance sessions for the course(s) you are enrolled in. It will not be used for any
              other purpose without a separate, explicit consent.
            </p>
          </section>

          <section className="stack-sm">
            <h5>3. Data Storage and Retention</h5>
            <p>
              Your embedding is stored in a secured institutional database accessible only to
              authorised system administrators. Your data will be{' '}
              <strong>deleted within 30 days of the end of the academic session</strong> in which you
              are enrolled, in accordance with the NDPR data minimisation principle.
            </p>
          </section>

          <section className="stack-sm">
            <h5>4. Your Rights (NDPR Section 3.1)</h5>
            <ul>
              <li><strong>Right of Access</strong>: You may request a copy of the data held about you at any time.</li>
              <li><strong>Right to Erasure</strong>: You may request deletion of your biometric data by contacting the Department Data Controller.</li>
              <li><strong>Right to Object</strong>: You may object to biometric-based attendance. Alternative attendance verification methods are available upon request to your lecturer.</li>
              <li><strong>Right to Portability</strong>: You may request your data in a machine-readable format.</li>
            </ul>
          </section>

          <section className="stack-sm">
            <h5>5. Liveness Detection</h5>
            <p>
              The system uses a dual-layer liveness detection pipeline (blink challenge plus passive
              photoplethysmography analysis) to prevent spoofing attacks. This processing occurs
              entirely on-device. No biometric signal data is uploaded.
            </p>
          </section>

          <section className="stack-sm">
            <h5>6. Data Controller</h5>
            <p>
              <strong>Department of Computer Science</strong><br />
              University of Ilorin, Kwara State, Nigeria<br />
              Data Protection Officer Contact: dpo@unilorin.edu.ng
            </p>
          </section>

          <div className="alert alert-warning">
            Consent is voluntary. Withholding consent will not affect your academic standing.
            Alternative attendance verification remains available.
          </div>

          <div className="inline-meta">
            <span>NDPR Consent Form v1.0</span>
            <span>Issued by Unilorin Dept. of Computer Science</span>
            <span>{new Date().getFullYear()}</span>
          </div>
        </div>

        {!scrolledToBottom && (
          <p className="inline-meta" aria-live="polite">
            Scroll to the bottom to enable the checkbox
          </p>
        )}

        <label
          htmlFor="ndpr-consent-checkbox"
          className={`panel panel-body stack-sm${scrolledToBottom ? '' : ' text-muted'}`}
        >
          <input
            id="ndpr-consent-checkbox"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={!scrolledToBottom}
          />
          <span className="text-sm">
            I have read and understood this notice. I freely and voluntarily consent to the
            processing of my biometric facial data by the Department of Computer Science, University
            of Ilorin, solely for attendance verification as described above. I understand I may
            withdraw this consent at any time.
          </span>
        </label>

        <div className="form-actions">
          <button
            id="btn-ndpr-decline"
            className="btn btn-ghost"
            type="button"
            onClick={onDecline}
          >
            Decline
          </button>
          <button
            id="btn-ndpr-accept"
            className="btn btn-primary"
            type="button"
            disabled={!checked}
            onClick={handleAccept}
          >
            I consent and continue
          </button>
        </div>
      </div>
    </div>
  )
}
