import 'katex/dist/katex.min.css';
import 'simplebar-react/dist/simplebar.min.css';
import './scrollbar.css';
import { AppShell } from './components/app/AppShell';
import { useAppController } from './AppController';

export default function App() {
  const shellProps = useAppController();
  return <AppShell {...shellProps} />;
}
