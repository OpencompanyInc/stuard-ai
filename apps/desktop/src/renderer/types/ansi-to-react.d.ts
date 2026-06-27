declare module 'ansi-to-react' {
  import * as React from 'react';

  interface AnsiProps {
    children?: string;
    useClasses?: boolean;
    className?: string;
  }

  export default class Ansi extends React.Component<AnsiProps> {}
}
