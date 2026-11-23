import type { Metadata } from 'next';
import { AccessPanel } from '../../components/access/AccessPanel';
import { TopBar } from '../../components/activity/TopBar';
import { authEnabled } from '../../lib/auth-config';
import { ownerEmails } from '../../server/access';
import { accountStores } from '../../server/accounts/store';
import { currentViewer } from '../../server/viewer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Access · Sub50', robots: { index: false } };

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-12 sm:px-6">
      <p className="label">{title}</p>
      <p className="mt-3 max-w-md text-[14px] text-muted">{children}</p>
    </section>
  );
}

/** /access: the owner's invite-only switch and allowed accounts. */
export default async function AccessPage() {
  const owners = ownerEmails();
  const viewer = authEnabled ? await currentViewer() : null;
  const isOwner = !!viewer && viewer.emails.some((e) => owners.includes(e));
  const state = isOwner ? await accountStores().access.get() : null;

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <TopBar />
      <main className="mx-auto max-w-[900px] border-line min-[901px]:border-x">
        <section className="border-b border-line px-4 pt-9 pb-7 sm:px-6 sm:pt-12">
          <p className="label">access</p>
          <h1 className="mt-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink sm:text-[38px]">
            Who can use Sub50.
            <span className="text-faint"> Open to everyone, or invite-only.</span>
          </h1>
        </section>
        {!authEnabled ? (
          <Note title="accounts are off">This server runs without accounts, so it’s always open.</Note>
        ) : !viewer ? (
          <Note title="owner only">Sign in with the owner account to manage access.</Note>
        ) : !isOwner ? (
          <Note title="owner only">Only the owner can manage who uses Sub50.</Note>
        ) : (
          <AccessPanel initial={{ ...state!, owners }} />
        )}
      </main>
    </div>
  );
}
