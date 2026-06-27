'use client';

import Image from 'next/image';

interface AuthCardProps {
  children: React.ReactNode;
  className?: string;
  showLogo?: boolean;
}

/** Compact-pill shell shared by sign-in, status, and loading auth states. */
export function AuthCard({ children, className = '', showLogo = true }: AuthCardProps) {
  return (
    <div className={`auth-card flex w-full flex-col items-center ${className}`}>
      {showLogo && (
        <Image
          src="/stuard-mark.png"
          alt="Stuard"
          width={28}
          height={28}
          className="mb-5 h-7 w-7 object-contain"
          priority
        />
      )}
      {children}
    </div>
  );
}
