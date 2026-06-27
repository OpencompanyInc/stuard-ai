
import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Stuard AI services, including third-party integrations such as Google, Meta (WhatsApp, Facebook, Instagram, Threads), Microsoft, GitHub, Discord, Reddit, X, and Telnyx.',
};

export default function PrivacyPage() {
  return (
    <div className="bg-[#0A0A0B] text-[#D4D4D4]">
    <div className="mx-auto max-w-4xl px-6 pb-20 pt-32">
      <h1 className="mb-8 font-serif text-4xl font-medium text-white md:text-5xl">Privacy Policy</h1>
      <p className="mb-12 text-[#A3A3A3]">Last updated: May 15, 2026</p>

      <div className="prose prose-lg prose-invert max-w-none space-y-12">
        <section>
          <h2 className="text-2xl font-medium text-white mb-4">1. Introduction</h2>
          <p>
            At Stuard AI (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;), we respect your privacy and are committed to protecting your personal data.
            This Privacy Policy explains how we collect, use, and share information about you when you use our desktop application,
            website, and related services (collectively, the &ldquo;Service&rdquo;), including when you connect third-party
            integrations such as Google, Microsoft, Meta (Facebook, Instagram, Threads, WhatsApp), GitHub, Discord, Reddit, X, and Telnyx.
          </p>
          <p className="mt-4">
            Our core philosophy is <strong>&ldquo;Local-First.&rdquo;</strong> We design our software to keep as much of your personal data
            on your local device as possible, minimizing what is sent to our servers.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">2. Information We Collect</h2>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">A. Information You Provide to Us</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Account Information:</strong> When you sign up, we collect your email address and authentication credentials.</li>
            <li><strong>Profile Information:</strong> You may choose to provide a name, nickname, or other profile details.</li>
            <li><strong>Marketplace Content:</strong> If you publish workflows to our Marketplace, we collect and store that content publicly.</li>
            <li><strong>Support Communications:</strong> Information you provide when contacting support.</li>
          </ul>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">B. Information Collected Automatically</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Usage Data:</strong> We collect technical logs about how you use the Service, such as API calls, token usage, and error reports, to improve system stability.</li>
            <li><strong>Device Information:</strong> We may collect information about your device type, operating system, and unique device identifiers for licensing and security.</li>
          </ul>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">C. Data Processed via AI Providers</h3>
          <p>
            To provide AI assistant functionality, text inputs and necessary context are sent to third-party AI model providers
            (such as OpenAI, Google Gemini, Anthropic, and routing infrastructure such as OpenRouter). These providers are used solely for generating responses and are not permitted
            to use your data to train their models, subject to their respective enterprise terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">3. Local Data Storage</h2>
          <p>
            Stuard AI stores the following data <strong>locally on your device</strong>:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-4">
            <li><strong>Conversation History:</strong> Your chat logs and interaction history.</li>
            <li><strong>Knowledge Graph:</strong> Structured facts and memories the AI learns about you.</li>
            <li><strong>Task Data:</strong> Todos, plans, and local automation states.</li>
            <li><strong>Files:</strong> Documents and files you ask Stuard to manage.</li>
          </ul>
          <p className="mt-4">
            This local data is under your control. If you enable &ldquo;Cloud Sync&rdquo; (optional), an encrypted copy of this data
            may be stored on our servers to synchronize across your devices.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">4. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-4">
            <li>Provide, maintain, and improve the Service.</li>
            <li>Process transactions and manage your account.</li>
            <li>Sync your data across devices (if enabled).</li>
            <li>Facilitate the Marketplace for sharing workflows.</li>
            <li>Detect, prevent, and address technical issues or fraud.</li>
            <li>Communicate with you about updates, security alerts, and support.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">5. Data Sharing and Disclosure</h2>
          <p>We do not sell your personal data. We may share your data in the following circumstances:</p>
          <ul className="list-disc pl-6 space-y-2 mt-4">
            <li><strong>Service Providers:</strong> With third-party vendors who help us operate the Service (e.g., cloud hosting, payment processing, AI inference, messaging gateways).</li>
            <li><strong>Legal Compliance:</strong> If required by law, regulation, or legal process.</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, sale, or asset transfer.</li>
            <li><strong>With Your Consent:</strong> If you explicitly authorize us to share data (e.g., when you connect a third-party integration described in Section 6).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">6. Third-Party Integrations</h2>
          <p>
            Stuard AI lets you connect optional third-party services so the assistant can act on your behalf. Each integration is opt-in &mdash;
            we only access the data needed for the specific tasks you ask Stuard to perform. When you connect an integration, you authorize
            Stuard to access that service under the scopes you grant during the OAuth flow (or, for messaging integrations, the phone number
            you verify).
          </p>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">A. How Integration Credentials Are Stored</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Access tokens and refresh tokens are stored in our backend database (Supabase) using <strong>per-user envelope encryption</strong> (AES-256-GCM with keys derived via HKDF from a server-side pepper).</li>
            <li>Tokens are decrypted only in-memory when needed to execute a tool call you triggered.</li>
            <li>You can disconnect any integration at any time from the Integrations panel in the desktop app. Disconnecting deletes our copy of your tokens and revokes our ability to access that account.</li>
            <li>You can also revoke access directly from each provider&rsquo;s account dashboard (e.g., Google Account permissions, Microsoft account apps, Meta Business Settings, GitHub Settings &rarr; Applications).</li>
          </ul>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">B. Per-Integration Disclosures</h3>

          <div className="mt-4 space-y-6">
            <div>
              <h4 className="text-lg font-medium text-white">Google (Gmail, Drive, Calendar, Sheets, Docs, Tasks)</h4>
              <p className="mt-2">
                When you connect a Google service, Stuard AI requests only the minimum OAuth scopes required for the features you enable
                (for example, <code>gmail.send</code> to send mail you draft, <code>drive.file</code> to read or write files you select,
                or read scopes for Calendar, Sheets, Docs, and Tasks). Stuard&rsquo;s use and transfer of information received from Google
                APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
                including the <strong>Limited Use</strong> requirements. We do not use Google user data to train generalized AI models, do not
                sell Google user data, and do not transfer it to third parties except as needed to provide the feature you requested, comply with law,
                or protect the security of our service.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Microsoft Outlook</h4>
              <p className="mt-2">
                When you connect Outlook, Stuard requests Microsoft Graph scopes (such as <code>Mail.Read</code>) so it can read mail you
                ask it to summarize or act on. Tokens are obtained via PKCE-protected OAuth and stored encrypted as described above.
                You can revoke Stuard&rsquo;s access at any time from your Microsoft account&rsquo;s &ldquo;Apps and services&rdquo; page.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Meta &mdash; WhatsApp</h4>
              <p className="mt-2">
                When you connect WhatsApp, you provide a phone number and confirm ownership by sending a one-time code from your WhatsApp
                account to Stuard&rsquo;s WhatsApp Business number. Once linked, Stuard can send and receive messages, voice notes, images,
                and files between you and the assistant via the official <strong>WhatsApp Business Platform (Cloud API)</strong>.
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong>What we receive:</strong> the messages you send to Stuard&rsquo;s WhatsApp number, including text, attached media, and voice notes (which may be transcribed by a speech-to-text provider so the assistant can understand them).</li>
                <li><strong>What we send back:</strong> only replies generated in response to your messages or proactive notifications you have explicitly enabled.</li>
                <li><strong>What we store:</strong> your verified phone number, message metadata needed for delivery, and message content insofar as it is part of your conversation history (subject to the local-first principles in Section 3 and your sync settings).</li>
                <li><strong>What we do not do:</strong> we do not use WhatsApp messages for advertising, do not sell them, and do not share them with third parties except subprocessors needed to deliver, transcribe, or store the message at your request.</li>
              </ul>
              <p className="mt-2">
                Your use of WhatsApp through Stuard is also governed by Meta&rsquo;s
                <a href="https://www.whatsapp.com/legal/business-policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> WhatsApp Business Messaging Policy </a>
                and
                <a href="https://www.whatsapp.com/legal/privacy-policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> WhatsApp Privacy Policy</a>.
                You can disconnect at any time from the Integrations panel; disconnection deletes our copy of your WhatsApp identifiers and stops further messaging.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Meta &mdash; Facebook, Instagram, Threads</h4>
              <p className="mt-2">
                When you connect Facebook, Instagram, or Threads, Stuard receives an OAuth access token scoped to the permissions you
                approve during Meta&rsquo;s consent flow. We use this token only to perform the actions you request (e.g., read your profile,
                publish content, or fetch posts). Use of these integrations is also subject to Meta&rsquo;s
                <a href="https://developers.facebook.com/terms/" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Platform Terms </a>
                and
                <a href="https://www.facebook.com/privacy/policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Meta Privacy Policy</a>.
                We do not aggregate Meta data with data from other sources for advertising, do not sell Meta data, and do not retain it longer than needed
                to fulfill the requested action and your conversation history.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">GitHub</h4>
              <p className="mt-2">
                Connecting GitHub allows Stuard to read repositories and issues you have access to so it can answer questions and assist with code.
                We request only the OAuth scopes needed for the features you enable. Use is governed by GitHub&rsquo;s
                <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Privacy Statement</a>.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Discord</h4>
              <p className="mt-2">
                Connecting Discord allows Stuard to list servers and DMs you belong to and to read or send messages on your behalf when you ask.
                Use is governed by Discord&rsquo;s
                <a href="https://discord.com/privacy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Reddit</h4>
              <p className="mt-2">
                Connecting Reddit allows Stuard to browse, search, post, and comment on your behalf when you request. Use is governed by Reddit&rsquo;s
                <a href="https://www.reddit.com/policies/privacy-policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">X (Twitter)</h4>
              <p className="mt-2">
                Connecting X allows Stuard to read your timeline, post tweets, send DMs, and look up users on your behalf. X API usage may be billed against
                your Stuard credits as disclosed in the Integrations panel. Use is governed by X&rsquo;s
                <a href="https://x.com/en/privacy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Telnyx (SMS / Voice Calls)</h4>
              <p className="mt-2">
                When you connect a phone number for SMS or voice notifications, Stuard sends a verification code via Telnyx and stores the verified phone
                number. We use Telnyx to deliver messages and voice calls you trigger or have explicitly enabled. We do not use your phone number for marketing
                and do not share it with third parties other than Telnyx as our messaging carrier. Telnyx&rsquo;s handling of this data is governed by the
                <a href="https://telnyx.com/legal/privacy-policy" className="text-[#FF6B6E] hover:underline" target="_blank" rel="noopener noreferrer"> Telnyx Privacy Policy</a>.
                Standard message and data rates from your carrier may apply. Reply STOP to any SMS to opt out.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Local-Only Integrations</h4>
              <p className="mt-2">
                Some integrations &mdash; Python, FFmpeg, MediaPipe, Ollama, and Stuard Browser &mdash; run entirely on your own device. They do not transmit
                data to Stuard&rsquo;s servers as part of their normal operation. Their respective installers may, however, fetch software from official sources
                under their own privacy practices.
              </p>
            </div>

            <div>
              <h4 className="text-lg font-medium text-white">Webhooks &amp; User-Configured Endpoints</h4>
              <p className="mt-2">
                If you configure webhooks or other custom HTTP endpoints, Stuard will deliver data to the URLs you specify. You are responsible for the privacy and
                security practices of any endpoint you connect.
              </p>
            </div>
          </div>

          <h3 className="text-xl font-medium text-white mt-6 mb-2">C. Data Retention for Integrations</h3>
          <p>
            We retain integration access tokens for as long as the integration remains connected to your account. When you disconnect an integration, we delete the
            associated tokens and any account-identifying metadata that is no longer needed. Content fetched from a third-party service in the course of executing a
            task (e.g., the contents of an email you asked Stuard to summarize) is treated as part of your conversation history and is governed by Sections 3 and 8.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">7. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your data. Cloud-stored data is encrypted at rest and in transit, and
            integration tokens are additionally protected with per-user envelope encryption as described in Section 6. However, no method of transmission over the
            Internet or electronic storage is 100% secure, so we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">8. Your Rights</h2>
          <p>
            Depending on your location, you may have rights to access, correct, delete, or export your personal data.
            You can manage most of your data directly within the Stuard AI application &mdash; including disconnecting any integration, clearing local data, and
            deleting your account. For other requests, please contact us at the address in Section 12.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">9. International Data Transfers</h2>
          <p>
            Stuard AI is operated from the United States. If you access the Service from outside the U.S., your information may be transferred to, stored, and
            processed in the U.S. and other countries where our service providers operate. We rely on appropriate safeguards (such as standard contractual clauses)
            where required by law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">10. Children&apos;s Privacy</h2>
          <p>
            The Service is not intended for individuals under the age of 13 (or the higher age of digital consent in your jurisdiction). We do not knowingly collect
            personal data from children.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page
            and updating the &ldquo;Last updated&rdquo; date. Material changes affecting integrations will be highlighted in-product where reasonable.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-white mb-4">12. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or the way an integration handles your data, please contact us at <a href="mailto:support@stuard.ai" className="text-[#FF6B6E] hover:underline">support@stuard.ai</a>.
          </p>
        </section>
      </div>
    </div>
    </div>
  );
}
