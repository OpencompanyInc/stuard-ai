# Stuard.ai - Your Personal AI Steward

A modern, privacy-first AI assistant website built with Next.js, featuring wireless app control capabilities and advanced memory systems.

## 🚀 Live Site

**Production**: [stuard.ai](https://stuard.ai)
**Staging**: [stuard-ai-staging.vercel.app](https://stuard-ai-staging.vercel.app)

## ✨ Features

- **App Control**: Control your PC via the mobile app (screen share + voice)
- **Advanced Memory**: AI that learns and remembers your preferences
- **100% Private**: Your data stays on your device
- **Multi-Modal**: Text, voice, and image interactions
- **Free Trial**: 14-day trial with full feature access

## 🛠️ Tech Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript
- **Deployment**: Vercel
- **Authentication**: Ready for Firebase/Supabase integration

## 📱 Pages

- **Homepage**: Hero section and feature showcase
- **Features**: Detailed feature explanations
- **Download**: Pricing and system requirements
- **Auth Flow**: Complete signup/login with app control option
  - `/signup` - Account creation with app control
  - `/login` - User sign in
  - `/forgot-password` - Password reset
  - `/verify-email` - Email verification
  - `/reset-password` - New password creation

## 🚀 Getting Started

### Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

#### Env vars

Create `.env.local` with at least:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PRICE_STARTER=price_...
NEXT_PUBLIC_STRIPE_PRICE_PRO=price_...
# Optional base URL override (used for redirect URLs)
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# GitHub Releases (used by /api/download)
# Set these to point to the repo that hosts your Windows installer assets
GITHUB_OWNER=your_github_owner_or_org
GITHUB_REPO=your_repo_name
# Optional: GitHub token to increase API rate limits
# GITHUB_TOKEN=ghp_...
```

### Build & Deploy

```bash
# Build for production
npm run build

# Start production server
npm start

# Deploy to Vercel
vercel --prod
```

## 📁 Project Structure

```
src/
├── app/                    # Next.js app router pages
│   ├── login/             # Authentication pages
│   ├── signup/
│   ├── forgot-password/
│   ├── verify-email/
│   ├── reset-password/
│   ├── features/          # Feature pages
│   ├── download/          # Download/pricing
│   └── layout.tsx         # Root layout
├── components/            # Reusable components
│   ├── layout/           # Header, footer, etc.
│   ├── sections/         # Page sections
│   └── ui/              # UI components
└── styles/              # Global styles
```

## 🔧 Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
NEXT_PUBLIC_SITE_URL=https://stuard.ai
NEXT_PUBLIC_APP_NAME=Stuard.ai
# Add authentication and service keys as needed
```

## 📱 App Control Features

- **Screen Share**: View and control your desktop from the app
- **Voice Control**: Hands-free commands from your phone
- **Secure Authentication**: Encrypted communication
- **Privacy First**: Optional local-only mode

## 🔒 Privacy & Security

- **Local Data Storage**: Conversations stay on your device
- **No Data Selling**: Your information is never sold
- **GDPR Compliant**: Privacy-first design
- **SSL Encrypted**: Secure communication
- **Optional Cloud**: Use local AI models for complete offline operation

## 📧 Contact & Support

- **Website**: [stuard.ai](https://stuard.ai)
- **Support**: support@stuard.ai
- **Issues**: Create an issue in this repository

## 📄 License

Private - All rights reserved to Stuard.ai

---

Built with ❤️ for privacy-conscious AI users
