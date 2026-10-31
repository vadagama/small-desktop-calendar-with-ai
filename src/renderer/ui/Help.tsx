import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Search, Sparkles, ZoomIn } from "lucide-react";
import type { HelpAction, HelpArticle } from "./help-types";
import "./help.css";

export function Help({
  onPrompt,
  onAction,
  articles: helpArticles,
}: {
  articles: HelpArticle[];
  onPrompt: (text: string) => void;
  onAction: (action: HelpAction) => void;
}) {
  const reading = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("start");
  const [expanded, setExpanded] = useState(false);
  const matches = helpArticles.filter((article) =>
    [
      article.title,
      article.summary,
      ...article.steps,
      article.prompt,
      article.note,
    ]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru")),
  );
  const article = matches.find((item) => item.id === selected) ?? matches[0];
  const index = article ? helpArticles.indexOf(article) : -1;
  function selectLesson(id: string) {
    setSelected(id);
    setQuery("");
    setExpanded(false);
    requestAnimationFrame(() => heading.current?.focus());
  }
  useEffect(() => {
    reading.current?.scrollTo(0, 0);
  }, [article?.id]);
  return (
    <section className="help-section" aria-label="Руководство Small">
      <div className="help-layout">
        <aside className="help-sidebar">
          <div className="help-guide-title">
            <BookOpen size={18} />
            <strong>Руководство Small</strong>
          </div>
          <p className="help-guide-intro">
            Изучайте возможности и пробуйте их в приложении.
          </p>
          <label className="help-search">
            <Search size={15} />
            <input
              type="search"
              aria-label="Поиск по документации"
              placeholder="Найти в помощи"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setExpanded(false);
              }}
            />
          </label>
          <nav aria-label="Темы помощи">
            {[
              {
                title: "01 · Знакомство",
                ids: ["start", "auth", "llm", "voice", "calendar"],
              },
              {
                title: "02 · Планирование с AI",
                ids: ["slots", "search", "analytics"],
              },
              {
                title: "03 · Под себя",
                ids: ["notifications", "memory", "settings"],
              },
            ].map((group) => {
              const items = matches.filter((item) =>
                group.ids.includes(item.id),
              );
              return items.length ? (
                <div className="help-chapter" key={group.title}>
                  <span className="help-eyebrow">{group.title}</span>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      aria-current={
                        article?.id === item.id ? "page" : undefined
                      }
                      onClick={() => selectLesson(item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
          <p className="help-sidebar-note">
            От инструкции — к действию.
            <br />
            Примеры можно сразу подставить в диалог.
          </p>
        </aside>
        <div className="help-reading" ref={reading}>
          {article ? (
            <article key={article.id}>
              <div className="help-meta">
                УРОК {index + 1} ИЗ {helpArticles.length} <span>·</span> 2
                минуты
              </div>
              <h2 tabIndex={-1} ref={heading}>
                {article.title}
              </h2>
              <p className="help-summary">{article.summary}</p>
              <figure
                className={expanded ? "help-figure expanded" : "help-figure"}
              >
                <button
                  aria-label={
                    expanded ? "Уменьшить скриншот" : "Увеличить скриншот"
                  }
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}help/${article.image}.png`}
                    alt={article.caption}
                  />
                  <span>
                    <ZoomIn size={13} />
                    {expanded ? "Уменьшить" : "Рассмотреть"}
                  </span>
                </button>
                <figcaption>{article.caption}</figcaption>
              </figure>
              <h3>Как это сделать</h3>
              <ol className="help-steps">
                {article.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {article.prompt && (
                <section className="help-example" aria-label="Пример запроса">
                  <div className="help-example-title">
                    <Sparkles size={15} />
                    Попробуйте с ассистентом
                  </div>
                  <p>{article.prompt}</p>
                  <button
                    className="primary"
                    onClick={() => onPrompt(article.prompt!)}
                  >
                    Подставить запрос <ArrowUpRight size={14} />
                  </button>
                  <small>Появится в поле ввода. Отправку подтвердите вы.</small>
                </section>
              )}
              {article.action && (
                <button
                  className="help-action"
                  onClick={() => onAction(article.action!)}
                >
                  {article.actionLabel}
                  <ArrowUpRight size={15} />
                </button>
              )}
              <p className="help-note">
                <strong>Полезно знать</strong>
                {article.note}
              </p>
              <nav className="help-lesson-nav" aria-label="Порядок изучения">
                {index > 0 && (
                  <button
                    onClick={() => selectLesson(helpArticles[index - 1].id)}
                  >
                    <small>Назад</small>
                    {helpArticles[index - 1].title}
                  </button>
                )}
                {index < helpArticles.length - 1 && (
                  <button
                    aria-label={`Далее: ${helpArticles[index + 1].title}`}
                    onClick={() => selectLesson(helpArticles[index + 1].id)}
                  >
                    <small>Далее</small>
                    {helpArticles[index + 1].title} →
                  </button>
                )}
              </nav>
            </article>
          ) : (
            <div className="help-empty">
              <Search size={24} />
              <h3>Ничего не найдено</h3>
              <p>Попробуйте «встреча», «память» или «время».</p>
              <button className="secondary" onClick={() => setQuery("")}>
                Сбросить поиск
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
