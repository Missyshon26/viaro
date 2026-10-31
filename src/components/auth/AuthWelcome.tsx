import { Logo } from "@/components/brand/Logo";
import { SignInForm } from "./SignInForm";

export function AuthWelcome() {
  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="Welcome to ABL">
        <div className="relative z-10"><p className="text-sm font-bold tracking-[.24em]">ABL / OPERATIONS CONSOLE</p></div>
        <div className="relative z-10 py-10"><h2>{"Every trip.\nUnder control."}</h2><p className="mt-6 max-w-md text-base leading-relaxed text-[#bbd0e5]">Bring dispatch, people and platform performance together in one workspace.</p></div>
        <div className="auth-story-details relative z-10"><div className="auth-feature"><span>01</span>Trip operations</div><div className="auth-feature"><span>02</span>People & vehicles</div><div className="auth-feature"><span>03</span>Platform insights</div><p className="mt-8 text-xs text-[#bbd0e5]">Thoughtfully connected. Effortlessly moving.</p></div>
      </section>
      <section className="auth-content"><div className="auth-form">
        <Logo width={80} />
        <p className="mt-10 text-label font-bold uppercase tracking-widest text-accent">Operations console</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-3 text-body leading-relaxed text-fg-muted">Sign in to your admin account to continue.</p>
        <SignInForm />
        <p className="mt-8 border-t border-border pt-5 text-note leading-relaxed text-fg-muted">This workspace is for platform administrators. Use the account provided by your ABL team.</p>
      </div></section>
    </main>
  );
}
