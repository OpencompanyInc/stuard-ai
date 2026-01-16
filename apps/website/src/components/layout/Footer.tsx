import Link from 'next/link';

const Footer = () => {
  return (
    <footer className="bg-[#F3F1EB] text-gray-600 border-t border-black/5 py-12">
      <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-sm font-medium">
          © 2025 Stuard AI. All rights reserved.
        </div>
        <div className="flex gap-6 text-sm font-medium">
          <Link href="/privacy" className="hover:text-black transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-black transition-colors">Terms</Link>
          <Link href="/twitter" className="hover:text-black transition-colors">Twitter</Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
