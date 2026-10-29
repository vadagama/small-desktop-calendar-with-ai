import { useId, useLayoutEffect, useRef, useState } from "react";

export function EventAgenda({ text }: { text: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    const measure = () => {
      if (!expanded)
        setOverflow(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <section className="event-agenda" aria-label="Повестка">
      <p
        ref={paragraph}
        id={id}
        className={expanded ? "expanded" : "collapsed"}
      >
        {text}
      </p>
      {(overflow || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть" : "Показать полностью"}
        </button>
      )}
    </section>
  );
}
