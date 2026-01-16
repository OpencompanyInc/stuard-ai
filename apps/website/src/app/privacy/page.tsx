
import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Stuard AI services.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12 md:py-20">
      <h1 className="text-4xl md:text-5xl font-serif font-medium mb-8">Privacy Policy</h1>
      <p className="text-gray-600 mb-12">Last updated: December 24, 2025</p>

      <div className="prose prose-lg prose-gray max-w-none space-y-12">
        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">1. Introduction</h2>
          <p>
            At Stuard AI ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal data. 
            This Privacy Policy explains how we collect, use, and share information about you when you use our desktop application, 
            website, and related services (collectively, the "Service").
          </p>
          <p className="mt-4">
            Our core philosophy is <strong>"Local-First."</strong> We design our software to keep as much of your personal data 
            on your local device as possible, minimizing what is sent to our servers.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">2. Information We Collect</h2>
          
          <h3 className="text-xl font-medium text-gray-900 mt-6 mb-2">A. Information You Provide to Us</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Account Information:</strong> When you sign up, we collect your email address and authentication credentials.</li>
            <li><strong>Profile Information:</strong> You may choose to provide a name, nickname, or other profile details.</li>
            <li><strong>Marketplace Content:</strong> If you publish workflows to our Marketplace, we collect and store that content publicly.</li>
            <li><strong>Support Communications:</strong> Information you provide when contacting support.</li>
          </ul>

          <h3 className="text-xl font-medium text-gray-900 mt-6 mb-2">B. Information Collected Automatically</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Usage Data:</strong> We collect technical logs about how you use the Service, such as API calls, token usage, and error reports, to improve system stability.</li>
            <li><strong>Device Information:</strong> We may collect information about your device type, operating system, and unique device identifiers for licensing and security.</li>
          </ul>

          <h3 className="text-xl font-medium text-gray-900 mt-6 mb-2">C. Data Processed via AI Providers</h3>
          <p>
            To provide AI assistant functionality, text inputs and necessary context are sent to third-party AI model providers 
            (such as OpenAI, Google Gemini, or Anthropic). These providers are used solely for generating responses and are not permitted 
            to use your data to train their models, subject to their respective enterprise terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">3. Local Data Storage</h2>
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
            This local data is under your control. If you enable "Cloud Sync" (optional), an encrypted copy of this data 
            may be stored on our servers to synchronize across your devices.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">4. How We Use Your Information</h2>
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
          <h2 className="text-2xl font-medium text-gray-900 mb-4">5. Data Sharing and Disclosure</h2>
          <p>We do not sell your personal data. We may share your data in the following circumstances:</p>
          <ul className="list-disc pl-6 space-y-2 mt-4">
            <li><strong>Service Providers:</strong> With third-party vendors who help us operate the Service (e.g., cloud hosting, payment processing, AI inference).</li>
            <li><strong>Legal Compliance:</strong> If required by law, regulation, or legal process.</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, sale, or asset transfer.</li>
            <li><strong>With Your Consent:</strong> If you explicitly authorize us to share data (e.g., integrating with a third-party app like Google Calendar).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">6. Third-Party Integrations</h2>
          <p>
            If you connect Stuard AI to third-party services (e.g., Google, GitHub, Outlook), we will access and process data from those services 
            only as requested by you to perform specific tasks. Access tokens are stored securely (encrypted) and are used only for the intended purpose. 
            We do not store your external data on our servers unless explicitly required for a specific sync feature.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">7. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your data. 
            Cloud-stored data is encrypted at rest and in transit. However, no method of transmission over the Internet 
            or electronic storage is 100% secure, so we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">8. Your Rights</h2>
          <p>
            Depending on your location, you may have rights to access, correct, delete, or export your personal data. 
            You can manage most of your data directly within the Stuard AI application. For other requests, please contact us.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">9. Children's Privacy</h2>
          <p>
            The Service is not intended for individuals under the age of 13. We do not knowingly collect personal data from children.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page 
            and updating the "Last updated" date.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-medium text-gray-900 mb-4">11. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us at support@stuard.ai.
          </p>
        </section>
      </div>
    </div>
  );
}
