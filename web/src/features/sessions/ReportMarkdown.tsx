import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import styles from "./ReportMarkdown.module.css";

/**
 * Renders the claude report as Markdown. Raw HTML stays inert because
 * react-markdown does not parse it and `rehype-raw` is deliberately absent.
 * `rehype-highlight` only rewrites `code` nodes into highlighted spans, so it
 * does not widen what the renderer accepts either.
 */
export function ReportMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
