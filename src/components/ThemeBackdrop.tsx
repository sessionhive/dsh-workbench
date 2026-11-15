import { useEffect, useRef, type CSSProperties } from 'react';
import { themeMediaScrim, themeMediaUrl, type ThemeDefinition } from '../settings';

/**
 * 主题的自定义背景层：图片或循环视频铺满窗口，上面压一层主题色遮罩。
 * 放在 .app 的最底层（z-index 低于内容和纹理层），只在当前主题带素材时渲染。
 */
export function ThemeBackdrop({
  theme,
  motion = true,
  className = '',
}: {
  theme: ThemeDefinition;
  /** 全局动画关闭时暂停视频，只留第一帧。 */
  motion?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = theme.media;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (motion) void video.play().catch(() => undefined);
    else video.pause();
  }, [motion, media?.path]);

  if (!media?.path) return null;

  const src = themeMediaUrl(media.path);
  const style = {
    '--media-blur': `${media.blur}px`,
  } as CSSProperties;

  return (
    <div className={`theme-backdrop${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      {media.kind === 'video' ? (
        <video
          key={media.path}
          ref={videoRef}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
        />
      ) : (
        <img key={media.path} src={src} alt="" draggable={false} />
      )}
      <span className="theme-backdrop-scrim" style={{ background: themeMediaScrim(theme) }} />
    </div>
  );
}
