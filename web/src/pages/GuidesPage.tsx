import type { ReactElement } from 'react';
import { NavLink, useParams } from 'react-router';
import icon from '../assets/nzeta-icon.svg';
import { GUIDES, type GuideBlock } from '../guides';
import { useI18n } from '../i18n';

function Block({ block, soon }: { block: GuideBlock; soon: string }): ReactElement {
  if (block.kind === 'text') return <p>{block.text}</p>;
  if (block.src === null) {
    return (
      <figure className="guide-video placeholder">
        <img src={icon} alt="" className="zeta-breath" width="96" height="96" />
        <figcaption className="muted">{soon}</figcaption>
      </figure>
    );
  }
  const isFile = block.src.startsWith('/');
  return (
    <figure className="guide-video">
      {isFile ? (
        <video src={block.src} controls playsInline preload="metadata" />
      ) : (
        <iframe
          src={block.src}
          title={block.caption ?? 'video'}
          allow="fullscreen; picture-in-picture"
          loading="lazy"
        />
      )}
      {block.caption && <figcaption className="muted">{block.caption}</figcaption>}
    </figure>
  );
}

/**
 * /guides and /guides/:slug — the list on the left, the selected guide (video + text) in the
 * centre. The structure of a guide will follow the real material; GUIDES holds placeholders.
 */
export function GuidesPage(): ReactElement {
  const { slug } = useParams();
  const { lang, t } = useI18n();
  const guide = GUIDES.find((g) => g.slug === slug) ?? (slug === undefined ? GUIDES[0] : undefined);

  return (
    <div className="guides">
      <aside className="guides-nav" aria-label={t.guides.list}>
        <p className="guides-nav-title">{t.guides.list}</p>
        <ul>
          {GUIDES.map((g, i) => (
            <li key={g.slug}>
              <NavLink
                to={`/guides/${g.slug}`}
                className={({ isActive }) =>
                  isActive || (slug === undefined && i === 0) ? 'active' : undefined
                }
              >
                {g.title[lang]}
              </NavLink>
            </li>
          ))}
        </ul>
      </aside>
      <article className="guide">
        {guide ? (
          <>
            <h1>{guide.title[lang]}</h1>
            {guide.blocks[lang].map((b, i) => (
              <Block key={i} block={b} soon={t.guides.videoSoon} />
            ))}
          </>
        ) : (
          <p className="muted">{t.guides.notFound}</p>
        )}
      </article>
    </div>
  );
}
