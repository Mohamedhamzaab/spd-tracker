// ---------------------------------------------------------------------------
//  Landing. Public marketing entry point at "/". Four scroll sections sit
//  in front of a fixed 3D hero scene. The CTA flips between Sign in / Go to
//  app depending on whether a session is already held.
// ---------------------------------------------------------------------------
import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store.jsx';

const HeroScene = lazy(() => import('../components/HeroScene.jsx'));

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

function Section({ children, className = '' }) {
  return (
    <section className={`landing-section ${className}`}>
      <motion.div
        className="landing-section-inner"
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.35 }}
      >
        {children}
      </motion.div>
    </section>
  );
}

export default function Landing() {
  const { t } = useTranslation();
  const { user } = useStore();
  const ctaTo = user ? '/app' : '/login';
  const ctaLabel = user ? t('common.goToApp') : t('common.signIn');

  return (
    <div className="landing">
      <div className="landing-bg">
        <Suspense fallback={<div className="landing-bg-fallback" />}>
          <HeroScene />
        </Suspense>
      </div>

      <header className="landing-top">
        <div className="landing-brand">
          <div className="landing-brand-mark">Safari Park Project</div>
          <div className="landing-brand-name">Authority Engagement</div>
        </div>
        <nav className="landing-top-nav">
          <a href="#what" className="landing-nav-link">{t('landing.topbar.whatItTracks')}</a>
          <a href="#rules" className="landing-nav-link">{t('landing.topbar.howItWorks')}</a>
          <a href="#who" className="landing-nav-link">{t('landing.topbar.whoUsesIt')}</a>
          <Link to={ctaTo} className="btn btn-primary landing-cta-top">{ctaLabel}</Link>
        </nav>
      </header>

      <Section className="landing-hero">
        <div className="landing-eyebrow">{t('landing.hero.eyebrow')}</div>
        <h1 className="landing-h1">{t('landing.hero.title')}</h1>
        <p className="landing-lede">{t('landing.hero.lede')}</p>
        <div className="landing-cta-row">
          <Link to={ctaTo} className="btn btn-primary btn-lg">{ctaLabel}</Link>
          <a href="#what" className="btn btn-ghost btn-lg">{t('landing.hero.secondaryCta')}</a>
        </div>
        <div className="landing-scroll-hint">{t('landing.hero.scroll')}</div>
      </Section>

      <Section className="landing-what" >
        <a id="what" className="landing-anchor" />
        <div className="landing-two-col">
          <div>
            <div className="landing-kicker">What it tracks</div>
            <h2 className="landing-h2">Authority — Sub-Division — Communication.</h2>
            <p className="landing-body">
              The three-level structure carried over from the Excel tracker, now enforced by the
              database. Every communication belongs to a sub-division; every sub-division belongs
              to an authority. Replies link to the outbound they answer, and the overdue flag
              clears automatically the moment a response arrives.
            </p>
          </div>
          <ul className="landing-stat-grid">
            <li><div className="landing-stat-n">16</div><div className="landing-stat-l">Authorities</div></li>
            <li><div className="landing-stat-n">23</div><div className="landing-stat-l">Sub-divisions</div></li>
            <li><div className="landing-stat-n">16</div><div className="landing-stat-l">Starting comms</div></li>
            <li><div className="landing-stat-n">7d</div><div className="landing-stat-l">Overdue rule</div></li>
          </ul>
        </div>
      </Section>

      <Section className="landing-rules">
        <a id="rules" className="landing-anchor" />
        <div className="landing-kicker">How it works</div>
        <h2 className="landing-h2">The engagement ladder, computed in the database.</h2>
        <p className="landing-body landing-body-wide">
          Each communication is placed on a four-step ladder: <strong>Notify</strong> →
          <strong> Consult</strong> → <strong>Coordinate</strong> → <strong>Approve</strong>.
          The step is derived from the data, not entered by hand, so the engagement view is the
          same no matter who is looking. Outbound items without a reply for more than seven
          calendar days are flagged overdue — the moment the reply lands, the flag clears.
        </p>
        <ol className="landing-ladder">
          <li><span className="landing-ladder-n">1</span><div><div className="landing-ladder-h">Notify</div><div className="landing-ladder-d">First contact — letter, e-mail, formal request.</div></div></li>
          <li><span className="landing-ladder-n">2</span><div><div className="landing-ladder-h">Consult</div><div className="landing-ladder-d">Back-and-forth on scope, design, or constraints.</div></div></li>
          <li><span className="landing-ladder-n">3</span><div><div className="landing-ladder-h">Coordinate</div><div className="landing-ladder-d">Joint sessions, site visits, schedule alignment.</div></div></li>
          <li><span className="landing-ladder-n">4</span><div><div className="landing-ladder-h">Approve</div><div className="landing-ladder-d">No-objection, sign-off, or formal endorsement.</div></div></li>
        </ol>
      </Section>

      <Section className="landing-who">
        <a id="who" className="landing-anchor" />
        <div className="landing-kicker">Who uses it</div>
        <h2 className="landing-h2">One platform, three audiences.</h2>
        <div className="landing-roles">
          <div className="landing-role-card">
            <div className="landing-role-badge landing-role-editor">Editor</div>
            <div className="landing-role-org">ECG</div>
            <p>Logs communications, sub-divisions, and meetings. Uploads documents. The only role that writes.</p>
          </div>
          <div className="landing-role-card">
            <div className="landing-role-badge">Viewer</div>
            <div className="landing-role-org">Egis</div>
            <p>Read-only access to the live register. Sees the same data ECG sees, the moment it is entered.</p>
          </div>
          <div className="landing-role-card">
            <div className="landing-role-badge">Viewer</div>
            <div className="landing-role-org">Safari Park Doha</div>
            <p>Client view. Live dashboard, engagement ladder, overdue items, and meeting summary.</p>
          </div>
        </div>
      </Section>

      <Section className="landing-cta">
        <h2 className="landing-h2 landing-h2-center">{t('landing.footer.title')}</h2>
        <p className="landing-body landing-body-center">{t('landing.footer.body')}</p>
        <div className="landing-cta-row landing-cta-row-center">
          <Link to={ctaTo} className="btn btn-primary btn-lg">{ctaLabel}</Link>
        </div>
        <footer className="landing-foot">
          <span>{t('landing.footer.copyright')}</span>
          <span className="landing-foot-dot">·</span>
          <span>{t('landing.footer.contract')}</span>
        </footer>
      </Section>
    </div>
  );
}
