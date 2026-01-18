import React, { useRef, useState, useCallback } from 'react';
import { UploadCloud, File, X } from 'lucide-react';
import clsx from 'clsx';

export interface FileDropzoneProps {
  label?: string;
  accept?: string;
  maxFiles?: number;
  onDrop: (files: File[]) => void;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  label = 'Drop files here',
  accept,
  maxFiles = 1,
  onDrop
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      processFiles(newFiles);
    }
  };

  const processFiles = (newFiles: File[]) => {
    const validFiles = newFiles.slice(0, maxFiles);
    setFiles(validFiles);
    onDrop(validFiles);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
    onDrop(updated);
  };

  return (
    <div onClick={handleContainerClick} className="w-full max-w-md my-3">
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsx(
          "relative border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer group",
          isDragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-theme/30 hover:border-theme/50 hover:bg-theme-hover"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={maxFiles > 1}
          accept={accept}
          onChange={handleFileSelect}
        />

        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-2">
            <div className={clsx(
              "p-3 rounded-full transition-colors",
              isDragOver ? "bg-primary/20 text-primary" : "bg-theme-hover text-theme-muted group-hover:text-theme-fg"
            )}>
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-theme-fg">
              {label}
            </p>
            <p className="text-xs text-theme-muted">
              {accept ? accept.replace(/,/g, ', ') : 'Any file'} • Max {maxFiles}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-theme-card border border-theme/20 rounded-lg shadow-sm">
                <div className="p-2 bg-primary/10 text-primary rounded">
                  <File className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-theme-fg truncate">{file.name}</p>
                  <p className="text-[10px] text-theme-muted">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => removeFile(e, i)}
                  className="p-1 hover:bg-red-500/10 text-theme-muted hover:text-red-500 rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="mt-2 text-center">
              <span className="text-xs text-primary font-medium group-hover:underline">
                Click to change files
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


