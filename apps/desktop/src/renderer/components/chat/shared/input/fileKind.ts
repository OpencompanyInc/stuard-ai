import {
  AppWindow,
  Folder,
  Image as ImageIconLucide,
  Film,
  Music,
  Code as CodeIcon,
  Archive,
  FileText,
  File as FileIconLucide,
} from 'lucide-react';

export const getFileKindConfig = (k: string) => {
  switch (k) {
    case 'application': return { icon: AppWindow, color: 'text-blue-400', tile: '#3B82F6', label: 'APP' };
    case 'folder': return { icon: Folder, color: 'text-yellow-400', tile: '#EAB308', label: 'DIR' };
    case 'image': return { icon: ImageIconLucide, color: 'text-purple-300', tile: '#7A5CFF', label: 'IMG' };
    case 'video': return { icon: Film, color: 'text-red-400', tile: '#EF4444', label: 'VID' };
    case 'audio': return { icon: Music, color: 'text-pink-400', tile: '#EC4899', label: 'AUD' };
    case 'code': return { icon: CodeIcon, color: 'text-emerald-400', tile: '#10B981', label: 'CODE' };
    case 'archive': return { icon: Archive, color: 'text-orange-400', tile: '#F97316', label: 'ZIP' };
    case 'document': return { icon: FileText, color: 'text-sky-400', tile: '#0EA5E9', label: 'DOC' };
    default: return { icon: FileIconLucide, color: 'text-zinc-300', tile: '#525252', label: 'FILE' };
  }
};
