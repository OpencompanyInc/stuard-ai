import Link from 'next/link';

const Footer = () => {
  return (
    <footer className="bg-[#F3F1EB] text-gray-600 border-t border-black/5 py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-start gap-10 mb-10">
          <div className="max-w-xs">
            <div className="font-bold text-xl text-gray-900 mb-2">Stuard AI</div>
            <p className="text-sm text-gray-500 leading-relaxed">
              The desktop AI assistant that automates workflows, builds custom tools, and keeps your data private.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Product</h4>
              <ul className="space-y-2">
                <li><Link href="/download" className="hover:text-black transition-colors">Download</Link></li>
                <li><Link href="/pricing" className="hover:text-black transition-colors">Pricing</Link></li>
                <li><Link href="/marketplace" className="hover:text-black transition-colors">Marketplace</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Account</h4>
              <ul className="space-y-2">
                <li><Link href="/signup" className="hover:text-black transition-colors">Sign Up</Link></li>
                <li><Link href="/login" className="hover:text-black transition-colors">Sign In</Link></li>
                <li><Link href="/dashboard" className="hover:text-black transition-colors">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Legal</h4>
              <ul className="space-y-2">
                <li><Link href="/privacy" className="hover:text-black transition-colors">Privacy</Link></li>
                <li><Link href="/terms" className="hover:text-black transition-colors">Terms</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-black/5 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-sm text-gray-400">
            © 2025 Stuard AI Inc. All rights reserved.
          </div>
          <div className="flex gap-4 text-sm text-gray-400">
            <a href="https://twitter.com/stuardai" target="_blank" rel="noopener noreferrer" className="hover:text-black transition-colors">Twitter</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
