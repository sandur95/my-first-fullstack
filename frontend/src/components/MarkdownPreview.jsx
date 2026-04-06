import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'

SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('sql', sql)

/** Hoisted regex — js-hoist-regexp */
const LANG_RE = /language-(\w+)/

/**
 * Module-scope code block renderer — rerender-no-inline-components.
 * Fenced code with a language gets syntax highlighting;
 * inline code falls back to plain <code>.
 */
function CodeBlock({ className, children }) {
  const match = LANG_RE.exec(className || '')
  if (match) {
    return (
      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    )
  }
  return <code className={className}>{children}</code>
}

/** Hoisted constant props — rerender-memo-with-default-value */
const remarkPlugins = [remarkGfm]
const mdComponents = { code: CodeBlock }

/**
 * Memoised Markdown preview — rerender-memo.
 * react-markdown renders Markdown → React elements. No dangerouslySetInnerHTML.
 * Raw HTML in Markdown source is ignored by default. XSS-safe.
 *
 * @param {{ markdown: string }} props
 */
const MarkdownPreview = memo(function MarkdownPreview({ markdown }) {
  return (
    <div className="doc-preview-content">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownPreview
