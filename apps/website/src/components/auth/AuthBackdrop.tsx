'use client';

export function AuthBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0A0A0B]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 auth-bg" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-6 sm:py-10">
        {children}
      </div>
    </div>
  );
}
