import React from 'react';
import Anser, { type AnserJsonEntry } from 'anser';
import { escapeCarriageReturn } from 'escape-carriage';

type AnsiTextProps = {
  children?: string;
  className?: string;
  useClasses?: boolean;
  linkify?: boolean;
};

function fixBackspace(txt: string): string {
  let tmp = txt;
  do {
    txt = tmp;
    tmp = txt.replace(/[^\n]\x08/gm, '');
  } while (tmp.length < txt.length);
  return txt;
}

function ansiToJSON(input: string, useClasses: boolean): AnserJsonEntry[] {
  input = escapeCarriageReturn(fixBackspace(input));
  return Anser.ansiToJson(input, {
    json: true,
    remove_empty: true,
    use_classes: useClasses,
  });
}

function createClass(bundle: AnserJsonEntry): string | null {
  let classNames = '';
  if (bundle.bg) classNames += `${bundle.bg}-bg `;
  if (bundle.fg) classNames += `${bundle.fg}-fg `;
  if (bundle.decoration) classNames += `ansi-${bundle.decoration} `;
  if (classNames === '') return null;
  return classNames.substring(0, classNames.length - 1);
}

function createStyle(bundle: AnserJsonEntry): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (bundle.bg) style.backgroundColor = `rgb(${bundle.bg})`;
  if (bundle.fg) style.color = `rgb(${bundle.fg})`;
  return style;
}

function convertBundleIntoReact(linkify: boolean, useClasses: boolean, bundle: AnserJsonEntry, key: number) {
  const style = useClasses ? undefined : createStyle(bundle);
  const spanClassName = useClasses ? createClass(bundle) ?? undefined : undefined;

  if (!linkify) {
    return (
      <span key={key} style={style} className={spanClassName}>
        {bundle.content}
      </span>
    );
  }

  const content: React.ReactNode[] = [];
  const linkRegex = /(\s|^)(https?:\/\/(?:www\.|(?!www))[^\s.]+\.[^\s]{2,}|www\.[^\s]+\.[^\s]{2,})/g;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(bundle.content)) !== null) {
    const [, pre, url] = match;
    const startIndex = match.index + pre.length;

    if (startIndex > index) {
      content.push(bundle.content.substring(index, startIndex));
    }

    const href = url.startsWith('www.') ? `http://${url}` : url;
    content.push(
      <a key={index} href={href} target="_blank" rel="noreferrer">
        {url}
      </a>
    );

    index = linkRegex.lastIndex;
  }

  if (index < bundle.content.length) {
    content.push(bundle.content.substring(index));
  }

  return (
    <span key={key} style={style} className={spanClassName}>
      {content}
    </span>
  );
}

export default function AnsiText(props: AnsiTextProps) {
  const { className, useClasses = false, children = '', linkify = false } = props;

  return (
    <code className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {ansiToJSON(children, useClasses).map((b, i) => convertBundleIntoReact(linkify, useClasses, b, i))}
    </code>
  );
}
