/**
 * FileThumb — content-hub card thumbnail.
 *
 * Image files get a real preview; everything else falls back to its emoji icon.
 * Two variants:
 *   - 'cover'   : fixed-height, cropped box (uniform grid).
 *   - 'natural' : full-width, aspect-preserving (masonry waterfall).
 * Image sources are lazily resolved via an IntersectionObserver so a grid of
 * many images doesn't fire every read at once.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getFileIcon } from '@/renderer/pages/guid/components/RecentFiles';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';

type FileThumbProps = {
  name: string;
  /**
   * Resolves the image source (a `data:` URL or an http URL). Only invoked for
   * image files, and only once the card scrolls into view.
   */
  loadImage?: () => Promise<string | null>;
  variant?: 'cover' | 'natural';
  /** UnoCSS height class for the cover box / emoji area, e.g. 'h-72px'. */
  heightClass?: string;
  /** UnoCSS font-size class for the fallback emoji, e.g. 'text-44px'. */
  emojiClass?: string;
};

const FileThumb: React.FC<FileThumbProps> = ({
  name,
  loadImage,
  variant = 'cover',
  heightClass = 'h-72px',
  emojiClass = 'text-44px',
}) => {
  const isImage = getContentTypeByExtension(name) === 'image';
  const boxRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage || !loadImage || src || failed) return;
    const el = boxRef.current;
    if (!el) return;
    let cancelled = false;

    const resolve = () => {
      loadImage()
        .then((url) => {
          if (cancelled) return;
          if (url) setSrc(url);
          else setFailed(true);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        io.disconnect();
        resolve();
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [isImage, loadImage, src, failed]);

  if (!isImage) {
    return (
      <span className={`${heightClass} flex items-center justify-center leading-none ${emojiClass}`}>
        {getFileIcon(name)}
      </span>
    );
  }

  // Natural (waterfall): full-width, height follows the image's aspect ratio.
  if (variant === 'natural') {
    return (
      <div
        ref={boxRef}
        className='w-full flex items-center justify-center overflow-hidden rd-8px
          bg-[var(--color-fill-2)] border border-solid border-[var(--color-border-2)]'
        style={src && !failed ? undefined : { minHeight: 80 }}
      >
        {src && !failed ? (
          <img src={src} alt={name} className='w-full h-auto block' onError={() => setFailed(true)} />
        ) : (
          <span className={`flex items-center justify-center leading-none opacity-40 ${emojiClass}`}>
            {getFileIcon(name)}
          </span>
        )}
      </div>
    );
  }

  // Cover (grid): fixed-height cropped box.
  return (
    <div
      ref={boxRef}
      className={`w-full ${heightClass} flex items-center justify-center overflow-hidden rd-8px
        bg-[var(--color-fill-2)] border border-solid border-[var(--color-border-2)]`}
    >
      {src && !failed ? (
        <img src={src} alt={name} className='w-full h-full object-cover' onError={() => setFailed(true)} />
      ) : (
        <span className='text-28px leading-none opacity-40'>{getFileIcon(name)}</span>
      )}
    </div>
  );
};

export default FileThumb;
