"use client";
/* eslint-disable @next/next/no-img-element */

import React, { useRef, useState, useEffect, useCallback } from "react";
import { 
  Type, AlignLeft, AlignCenter, AlignRight, 
  Image as ImageIcon, Camera, Trash2,
  AlignVerticalJustifyStart, AlignVerticalJustifyEnd, AlignVerticalJustifyCenter,
  ChevronDown, Menu, SlidersHorizontal, X
} from "lucide-react";

// Figma-styled tiny components
const FigmaSelect = ({ value, onChange, options, className = "" }: {value: string, onChange: (v: string) => void, options: {label: string, value: string}[], className?: string}) => (
  <div className={`relative flex items-center ${className}`}>
    <select 
      value={value} 
      onChange={e => onChange(e.target.value)}
      className="w-full appearance-none bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-transparent hover:border-[#444] rounded-[3px] text-[11px] text-[#e0e0e0] px-2 py-1 outline-none transition-colors"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronDown className="absolute right-1.5 h-3 w-3 text-[#888] pointer-events-none" />
  </div>
);

const FigmaInput = ({ value, onChange, placeholder, type = "text", icon }: {value: string, onChange: (v: string) => void, placeholder?: string, type?: string, icon?: React.ReactNode}) => (
  <div className="relative flex items-center bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-transparent hover:border-[#444] rounded-[3px] transition-colors focus-within:border-[#0f8bfd] focus-within:bg-[#1e1e1e]">
    {icon && <span className="pl-2 text-[#888] text-[10px]">{icon}</span>}
    <input 
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent text-[11px] text-[#e0e0e0] px-2 py-1 outline-none placeholder:text-[#555]"
    />
  </div>
);

const FigmaIconButton = ({ icon: Icon, active, onClick }: {icon: React.ElementType, active: boolean, onClick: () => void}) => (
  <button 
    onClick={onClick}
    className={`p-1.5 rounded-[3px] flex items-center justify-center transition-colors ${active ? 'bg-[#333] text-white' : 'text-[#888] hover:text-[#ccc] hover:bg-[#2a2a2a]'}`}
  >
    <Icon className="h-3.5 w-3.5" />
  </button>
);

const FILTER_PRESETS: { label: string; value: string; css: string }[] = [
  { label: "None", value: "none", css: "none" },
  { label: "B&W", value: "bw", css: "grayscale(1) contrast(1.1)" },
  { label: "Sepia", value: "sepia", css: "sepia(0.8) contrast(1.05) brightness(1.05)" },
  { label: "Vintage", value: "vintage", css: "sepia(0.35) contrast(0.9) brightness(1.05) saturate(1.2)" },
  { label: "Vivid", value: "vivid", css: "contrast(1.15) saturate(1.4)" },
];

const PHOTOS_STORAGE_KEY = "camera-app:photos";
const SETTINGS_STORAGE_KEY = "camera-app:settings";
const MAX_STORED_PHOTOS = 12;

// Shared GPS map card dimensions (base/1x units) — kept identical between the
// live DOM preview and the canvas burn-in so they never drift out of sync.
const MAP_CARD_W = 150;
const MAP_CARD_H = 104;

type StoredPhoto = { id: string; url: string; name: string };
type StoredSettings = Record<string, string | boolean | undefined>;

// Parsed once per page load and cached, so each useState lazy initializer
// below doesn't re-read/re-parse localStorage on every field.
let cachedStoredSettings: StoredSettings | null = null;

const loadStoredPhotos = (): StoredPhoto[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PHOTOS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadStoredSettings = (): StoredSettings => {
  if (cachedStoredSettings) return cachedStoredSettings;
  if (typeof window === "undefined") return {};
  let result: StoredSettings = {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    result = raw ? JSON.parse(raw) : {};
  } catch {
    result = {};
  }
  cachedStoredSettings = result;
  return result;
};

/**
 * Re-encodes a JPEG/PNG data URL through a fresh off-screen canvas so that
 * any EXIF / XMP / IPTC metadata from the original source is guaranteed to
 * be absent in the output.  canvas.toDataURL() never carries metadata from
 * video frames, but this acts as an explicit, auditable strip step for the
 * full download path as well.
 */
const stripImageMetadata = (dataUrl: string, quality = 0.95): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

export default function CameraApp() {
  // Layers / Photos Cache (lazily hydrated from localStorage on first render)
  const [photos, setPhotos] = useState<StoredPhoto[]>(loadStoredPhotos);
  const [exportQuality, setExportQuality] = useState("MAX");
  const [exportSaveSettings, setExportSaveSettings] = useState(true);
  const [activeLayer, setActiveLayer] = useState<string>("camera"); // "camera" or photo id

  // Design presets and map coordinates states
  // NOTE: All settings are initialized with static defaults so SSR and client
  // render identically. The real values are hydrated from localStorage in the
  // useEffect below, after the first paint.
  const [designPreset, setDesignPreset] = useState("standard");
  const [latLng, setLatLng] = useState<{lat: number, lng: number} | null>(null);
  const [mapDataUrl, setMapDataUrl] = useState<string>("");

  // Countdown Timer states
  const [timerDuration, setTimerDuration] = useState(0); // in seconds
  const [isCustomTimer, setIsCustomTimer] = useState(false);
  const [customTimerInput, setCustomTimerInput] = useState("10");
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdownValue, setCountdownValue] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mobile responsiveness sidebar states
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);

  // Camera State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // WYSIWYG Scale state
  const [videoScale, setVideoScale] = useState(1);
  const resizeObserver = useRef<ResizeObserver | null>(null);

  // Settings State — static defaults, hydrated from localStorage after mount
  const [fontFamily, setFontFamily] = useState("Inter");
  const [fontWeight, setFontWeight] = useState("400");
  const [fontSize, setFontSize] = useState("32");
  const [alignX, setAlignX] = useState<"left" | "center" | "right">("right");
  const [alignY, setAlignY] = useState<"top" | "center" | "bottom">("bottom");

  const [fillColor, setFillColor] = useState("#000000");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [hasStroke, setHasStroke] = useState(false);

  const [template, setTemplate] = useState("standard");
  const [manualLocation, setManualLocation] = useState("");
  const [colorFilter, setColorFilter] = useState("none");

  // Manual date/time override
  const [useManualDateTime, setUseManualDateTime] = useState(false);
  const [manualDateTime, setManualDateTime] = useState("");

  // Data
  const [liveTime, setLiveTime] = useState<Date | null>(null);
  const [gpsAddress, setGpsAddress] = useState("");

  // Hydrate settings + photos from localStorage after first mount (avoids SSR mismatch)
  useEffect(() => {
    const s = loadStoredSettings();
    if (s.designPreset) setDesignPreset(s.designPreset as string);
    if (s.fontFamily)   setFontFamily(s.fontFamily as string);
    if (s.fontWeight)   setFontWeight(s.fontWeight as string);
    if (s.fontSize)     setFontSize(s.fontSize as string);
    if (s.alignX)       setAlignX(s.alignX as "left" | "center" | "right");
    if (s.alignY)       setAlignY(s.alignY as "top" | "center" | "bottom");
    if (s.fillColor)    setFillColor(s.fillColor as string);
    if (s.strokeColor)  setStrokeColor(s.strokeColor as string);
    if (s.hasStroke !== undefined) setHasStroke(Boolean(s.hasStroke));
    if (s.template)     setTemplate(s.template as string);
    if (s.colorFilter)  setColorFilter(s.colorFilter as string);
    // Also hydrate photos
    setPhotos(loadStoredPhotos());
    // Start live clock after mount so server and client share the same initial null
    setLiveTime(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist photo history to localStorage whenever it changes (capped, with quota fallback)
  useEffect(() => {
    const capped = photos.slice(0, MAX_STORED_PHOTOS);
    let toStore = capped;
    while (toStore.length > 0) {
      try {
        localStorage.setItem(PHOTOS_STORAGE_KEY, JSON.stringify(toStore));
        return;
      } catch {
        // Quota exceeded — drop the oldest photo and retry
        toStore = toStore.slice(0, -1);
      }
    }
    try {
      localStorage.removeItem(PHOTOS_STORAGE_KEY);
    } catch {
      // Ignore — nothing more we can do
    }
  }, [photos]);

  // Persist design settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        designPreset, fontFamily, fontWeight, fontSize, alignX, alignY,
        fillColor, strokeColor, hasStroke, template, colorFilter,
      }));
    } catch {
      // Storage unavailable/full — settings just won't persist this session
    }
  }, [designPreset, fontFamily, fontWeight, fontSize, alignX, alignY, fillColor, strokeColor, hasStroke, template, colorFilter]);

  // Time ticker
  useEffect(() => {
    const interval = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Update scale when video element resizes
  useEffect(() => {
    if (videoRef.current) {
      resizeObserver.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const rect = entry.contentRect;
          const vw = videoRef.current?.videoWidth || 1920; // fallback to 1080p width
          if (vw > 0) setVideoScale(rect.width / vw);
        }
      });
      resizeObserver.current.observe(videoRef.current);
    }
    return () => resizeObserver.current?.disconnect();
  }, [cameraActive, activeLayer]);

  const fetchLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsAddress("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLatLng({ lat: latitude, lng: longitude });
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
          if (res.ok) {
            const data = await res.json();
            setGpsAddress(data.display_name || `Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`);
          }
        } catch {
          setGpsAddress(`Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`);
        }
      },
      () => setGpsAddress("Location denied/unavailable"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // Fetch and render Map Tile to Data URL
  useEffect(() => {
    if (!latLng) return;
    
    let isMounted = true;
    const renderMap = async () => {
      try {
        const { lat, lng } = latLng;
        const zoom = 17;
        const scale = Math.pow(2, zoom);
        const tileSize = 256;
        const dpr = 2; // fetch @2x retina tiles for a sharper map at small display sizes

        // Calculate fractional tile coordinates
        const tileX = (lng + 180) / 360 * scale;
        const latRad = lat * Math.PI / 180;
        const tileY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;

        // Canvas size (rendered at 2x, downscaled visually by the display size)
        const w = MAP_CARD_W * dpr;
        const h = MAP_CARD_H * dpr;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Find surrounding tiles to fetch (usually a 2x2 or 3x3 grid)
        const minX = Math.floor(tileX - (w / 2) / tileSize);
        const maxX = Math.floor(tileX + (w / 2) / tileSize);
        const minY = Math.floor(tileY - (h / 2) / tileSize);
        const maxY = Math.floor(tileY + (h / 2) / tileSize);

        const loadImage = (url: string) => {
          return new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
          });
        };

        const tilePromises = [];
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const url = `https://a.basemaps.cartocdn.com/dark_all/${zoom}/${x}/${y}@2x.png`;
            tilePromises.push(loadImage(url).then(img => ({ img, x, y })));
          }
        }

        const loadedTiles = await Promise.all(tilePromises);
        if (!isMounted) return;

        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, w, h);

        loadedTiles.forEach(({ img, x, y }) => {
          if (!img) return;
          const dx = (x - tileX) * tileSize;
          const dy = (y - tileY) * tileSize;
          ctx.drawImage(img, (w / 2) + dx, (h / 2) + dy, tileSize, tileSize);
        });

        // Draw a polished "you are here" pin: soft glow ring + solid dot + white ring
        const cx = w / 2;
        const cy = h / 2;

        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14 * dpr);
        glow.addColorStop(0, "rgba(15, 139, 253, 0.45)");
        glow.addColorStop(1, "rgba(15, 139, 253, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, 14 * dpr, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "#0f8bfd";
        ctx.beginPath();
        ctx.arc(cx, cy, 5 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        setMapDataUrl(canvas.toDataURL());
      } catch (err) {
        console.error("Map render error:", err);
      }
    };
    
    renderMap();
    return () => { isMounted = false; };
  }, [latLng]);

  const startCamera = async () => {
    try {
      fetchLocation();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Trigger scale update once metadata is loaded
        videoRef.current.onloadedmetadata = () => {
          const vw = videoRef.current?.videoWidth || 1920;
          const rect = videoRef.current?.getBoundingClientRect();
          if (rect && vw > 0) setVideoScale(rect.width / vw);
        };
      }
      setCameraActive(true);
      setActiveLayer("camera");
      setCameraError("");
    } catch {
      setCameraError("Akses Kamera Ditolak.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };

  }, []);

  const wrapText = (text: string, maxChars: number) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";
    
    words.forEach(word => {
      if ((currentLine + word).length > maxChars) {
        if (currentLine.length > 0) lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    });
    if (currentLine.length > 0) lines.push(currentLine.trim());
    return lines;
  };

  const getDisplayTime = (): Date => {
    if (useManualDateTime && manualDateTime) {
      const parsed = new Date(manualDateTime);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    // liveTime is null before mount (SSR); fall back to current time so callers
    // always receive a valid Date without needing individual null checks.
    return liveTime ?? new Date();
  };

  const getWatermarkLines = () => {
    const timeStr = getDisplayTime().toLocaleString("en-GB");
    const locStr = manualLocation || gpsAddress || "Mencari Lokasi GPS...";
    
    const wrappedLoc = wrapText(locStr, 35);
    
    if (template === "minimal") return [timeStr];
    if (template === "location_only") return wrappedLoc;
    return [timeStr, ...wrappedLoc]; // standard
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    // Draw video frame mirrored to match preview, applying the active color filter
    ctx.save();
    ctx.filter = FILTER_PRESETS.find(f => f.value === colorFilter)?.css || "none";
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // Base sizing variables
    const size = parseInt(fontSize) || 32;
    const padding = size * 1.5;

    // Safe roundRect checking/calling interface
    const ctxWithRoundRect = ctx as unknown as { roundRect(x: number, y: number, w: number, h: number, r: number): void };

    if (designPreset === "standard" || designPreset === "retro") {
      // Standard / Retro text layout
      const lines = getWatermarkLines();
      ctx.font = `${fontWeight} ${size}px ${fontFamily}, sans-serif`;
      const lineHeight = size * 1.2;

      ctx.fillStyle = fillColor;
      if (hasStroke) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(1, size / 15);
      }
      
      ctx.textAlign = alignX;

      // Calculate X
      let xPos = padding;
      if (alignX === "center") xPos = width / 2;
      if (alignX === "right") xPos = width - padding;

      // Calculate Y
      const totalTextHeight = lines.length * lineHeight;
      let startY = padding + size; // top
      if (alignY === "center") startY = (height / 2) - (totalTextHeight / 2) + size;
      if (alignY === "bottom") startY = height - padding - totalTextHeight + size;

      lines.forEach((line, i) => {
        const y = startY + (i * lineHeight);
        if (hasStroke) ctx.strokeText(line, xPos, y);
        ctx.fillText(line, xPos, y);
      });
    } else if (designPreset === "dark_card") {
      // Figma Dark Card Layout
      const lines = getWatermarkLines();
      ctx.font = `${fontWeight} ${size}px ${fontFamily}, sans-serif`;
      const lineHeight = size * 1.2;

      // Calculate text block size
      ctx.textAlign = "left"; // Draw text left-aligned inside card
      let maxLineWidth = 0;
      lines.forEach(line => {
        const w = ctx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      });

      const cardPadding = size * 0.4;
      const cardWidth = maxLineWidth + cardPadding * 2;
      const cardHeight = lines.length * lineHeight - (lineHeight - size) + cardPadding * 2;

      // Calculate card position
      let cardX = padding;
      if (alignX === "center") cardX = (width - cardWidth) / 2;
      if (alignX === "right") cardX = width - padding - cardWidth;

      let cardY = padding;
      if (alignY === "center") cardY = (height - cardHeight) / 2;
      if (alignY === "bottom") cardY = height - padding - cardHeight;

      // Draw Card Background
      ctx.fillStyle = "rgba(15, 15, 15, 0.55)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = Math.max(1, size / 30);
      
      const radius = size * 0.2;
      ctx.beginPath();
      if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(cardX, cardY, cardWidth, cardHeight, radius);
      } else {
        drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, radius);
      }
      ctx.fill();
      ctx.stroke();

      // Draw Text
      ctx.fillStyle = fillColor;
      const textStartX = cardX + cardPadding;
      const textStartY = cardY + cardPadding + size * 0.85;

      lines.forEach((line, i) => {
        ctx.fillText(line, textStartX, textStartY + (i * lineHeight));
      });
    } else if (designPreset === "map_card") {
      // GPS Map Card Layout
      const scaleFactor = size / 32;
      const cardPadding = 16 * scaleFactor;
      const mapW = MAP_CARD_W * scaleFactor;
      const mapH = MAP_CARD_H * scaleFactor;
      const gap = 16 * scaleFactor;
      const textAreaWidth = 260 * scaleFactor;
      const cardWidth = cardPadding * 2 + mapW + gap + textAreaWidth;
      const cardHeight = cardPadding * 2 + mapH;

      // Calculate position
      let cardX = padding;
      if (alignX === "center") cardX = (width - cardWidth) / 2;
      if (alignX === "right") cardX = width - padding - cardWidth;

      let cardY = padding;
      if (alignY === "center") cardY = (height - cardHeight) / 2;
      if (alignY === "bottom") cardY = height - padding - cardHeight;

      // Draw Card Background
      ctx.fillStyle = "rgba(15, 15, 15, 0.55)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = Math.max(1, 1.5 * scaleFactor);
      
      const radius = 8 * scaleFactor;
      ctx.beginPath();
      if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(cardX, cardY, cardWidth, cardHeight, radius);
      } else {
        drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, radius);
      }
      ctx.fill();
      ctx.stroke();

      // Draw Map Area
      const mapX = cardX + cardPadding;
      const mapY = cardY + cardPadding;

      ctx.save();
      // Clip map area
      ctx.beginPath();
      if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(mapX, mapY, mapW, mapH, 6 * scaleFactor);
      } else {
        drawRoundedRect(ctx, mapX, mapY, mapW, mapH, 6 * scaleFactor);
      }
      ctx.clip();

      if (mapDataUrl) {
        try {
          const mapImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.src = mapDataUrl;
            img.onload = () => resolve(img);
            img.onerror = () => reject();
          });
          ctx.drawImage(mapImg, mapX, mapY, mapW, mapH);
        } catch {
          // Fallback map background
          ctx.fillStyle = "#121212";
          ctx.fillRect(mapX, mapY, mapW, mapH);
        }
      } else {
        // Fallback map background
        ctx.fillStyle = "#121212";
        ctx.fillRect(mapX, mapY, mapW, mapH);
      }
      ctx.restore();

      // Draw Map border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(mapX, mapY, mapW, mapH, 6 * scaleFactor);
      } else {
        drawRoundedRect(ctx, mapX, mapY, mapW, mapH, 6 * scaleFactor);
      }
      ctx.stroke();

      // Draw Text Details (Right side)
      const textX = mapX + mapW + gap;
      ctx.textAlign = "left";

      // 1. Address (Wrapped, truncated with ellipsis beyond 2 lines)
      ctx.font = `500 ${13 * scaleFactor}px ${fontFamily}, sans-serif`;
      ctx.fillStyle = "#f0f0f0";
      const locStr = manualLocation || gpsAddress || "Mencari Lokasi GPS...";
      // Wrap location string to fit the wider card
      const maxChars = 34;
      const wrappedLoc = wrapText(locStr, maxChars);

      let currentY = mapY + 18 * scaleFactor;
      wrappedLoc.slice(0, 2).forEach((line, i) => {
        const isLastVisibleLine = i === 1 && wrappedLoc.length > 2;
        ctx.fillText(isLastVisibleLine ? `${line.trimEnd()}…` : line, textX, currentY);
        currentY += 16 * scaleFactor;
      });

      // 2. Timestamp
      ctx.font = `normal ${10 * scaleFactor}px monospace, sans-serif`;
      ctx.fillStyle = "#888888";
      
      const timeY = mapY + mapH - 8 * scaleFactor;
      ctx.fillText(getDisplayTime().toLocaleString("en-GB"), textX, timeY);
    } else if (designPreset === "minimal_badge") {
      // Minimal pill badge showing just the time
      const scaleFactor = size / 32;
      const badgeText = getDisplayTime().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      ctx.font = `600 ${13 * scaleFactor}px ${fontFamily}, sans-serif`;
      const textW = ctx.measureText(badgeText).width;

      const dotR = 3 * scaleFactor;
      const badgePaddingX = 14 * scaleFactor;
      const gapDot = 8 * scaleFactor;
      const badgeHeight = 30 * scaleFactor;
      const badgeWidth = badgePaddingX * 2 + dotR * 2 + gapDot + textW;

      let badgeX = padding;
      if (alignX === "center") badgeX = (width - badgeWidth) / 2;
      if (alignX === "right") badgeX = width - padding - badgeWidth;

      let badgeY = padding;
      if (alignY === "center") badgeY = (height - badgeHeight) / 2;
      if (alignY === "bottom") badgeY = height - padding - badgeHeight;

      ctx.fillStyle = "rgba(15, 15, 15, 0.6)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = Math.max(1, scaleFactor);
      ctx.beginPath();
      if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
        ctxWithRoundRect.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
      } else {
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
      }
      ctx.fill();
      ctx.stroke();

      const dotCx = badgeX + badgePaddingX + dotR;
      const dotCy = badgeY + badgeHeight / 2;
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(dotCx, dotCy, dotR, 0, 2 * Math.PI);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = fillColor;
      ctx.fillText(badgeText, dotCx + dotR + gapDot, dotCy);
      ctx.textBaseline = "alphabetic";
    } else if (designPreset === "film_strip") {
      // Full-width film-reel style bar with sprocket holes and a date stamp
      const scaleFactor = size / 32;
      const barHeight = 44 * scaleFactor;
      const holeSize = 10 * scaleFactor;
      const holeGap = 22 * scaleFactor;

      const barY = alignY === "top" ? 0 : height - barHeight;

      ctx.fillStyle = "rgba(10, 10, 10, 0.75)";
      ctx.fillRect(0, barY, width, barHeight);

      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      const holeY = barY + barHeight / 2 - holeSize / 2;
      for (let x = holeGap / 2; x < width; x += holeGap) {
        if ('roundRect' in ctx && typeof ctxWithRoundRect.roundRect === 'function') {
          ctx.beginPath();
          ctxWithRoundRect.roundRect(x, holeY, holeSize, holeSize, 2 * scaleFactor);
          ctx.fill();
        } else {
          ctx.beginPath();
          drawRoundedRect(ctx, x, holeY, holeSize, holeSize, 2 * scaleFactor);
          ctx.fill();
        }
      }

      ctx.font = `600 ${14 * scaleFactor}px monospace, sans-serif`;
      ctx.fillStyle = "#ff7700";
      ctx.textAlign = alignX === "left" ? "left" : (alignX === "right" ? "right" : "center");
      ctx.textBaseline = "middle";
      const textX2 = alignX === "left" ? padding : (alignX === "right" ? width - padding : width / 2);
      const locStr = manualLocation || gpsAddress || "";
      const badgeLine = template === "location_only" ? locStr : getDisplayTime().toLocaleString("en-GB");
      ctx.fillText(badgeLine, textX2, barY + barHeight / 2);
      ctx.textBaseline = "alphabetic";
    }

    // Strip metadata: re-encode through a fresh canvas before storing
    const rawDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const cleanDataUrl = await stripImageMetadata(rawDataUrl, 0.95);
    const newPhoto = {
      id: Date.now().toString(),
      url: cleanDataUrl,
      name: `Photo ${photos.length + 1}`
    };
    
    setPhotos([newPhoto, ...photos]);
    setActiveLayer(newPhoto.id); // auto switch to preview
  };

  const startCaptureWithTimer = () => {
    if (isCountingDown) return;
    
    const duration = isCustomTimer ? (parseInt(customTimerInput) || 0) : timerDuration;
    
    if (duration <= 0) {
      // Flash effect
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 150);
      capturePhoto();
      return;
    }

    setIsCountingDown(true);
    setCountdownValue(duration);

    countdownIntervalRef.current = setInterval(() => {
      setCountdownValue((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          setIsCountingDown(false);
          // Trigger visual flash
          setShowFlash(true);
          setTimeout(() => setShowFlash(false), 150);
          capturePhoto();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const activePhotoObj = photos.find(p => p.id === activeLayer);

  return (
    <div className="flex h-screen w-full bg-[#1e1e1e] text-[#d4d4d4] overflow-hidden select-none relative">
      
      {/* Backdrop for Left Sidebar on Mobile */}
      {showLeftSidebar && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-20 md:hidden" 
          onClick={() => setShowLeftSidebar(false)}
        />
      )}

      {/* LEFT PANEL: Figma Layers */}
      <div className={`fixed md:relative inset-y-0 left-0 w-60 bg-[#2c2c2c] border-r border-[#111] flex flex-col shrink-0 shadow-lg z-30 transition-transform duration-300 md:translate-x-0 ${showLeftSidebar ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="h-10 flex items-center justify-between px-4 border-b border-[#111] bg-[#2c2c2c] sticky top-0">
          <span className="text-[11px] font-semibold tracking-wide text-white">Layers</span>
          <button 
            onClick={() => setShowLeftSidebar(false)} 
            className="md:hidden p-1 text-[#888] hover:text-white transition-colors"
            title="Tutup Layers"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
          {/* Active Camera Layer */}
          <div 
            className={`px-4 py-2 mt-1 flex items-center gap-2 cursor-pointer text-sm font-medium transition-colors ${activeLayer === "camera" ? "bg-[#383838] text-white" : "text-[#d4d4d4] hover:bg-[#333]"}`}
            onClick={() => {
              setActiveLayer("camera");
              setShowLeftSidebar(false);
            }}
          >
            <Camera className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[12px] font-medium truncate">Live Camera</span>
          </div>

          <div className="px-4 py-2 mt-2">
            <span className="text-[10px] font-semibold text-[#888] uppercase tracking-wider">History</span>
          </div>

          {/* Photos Cache */}
          {photos.map(p => (
            <div 
              key={p.id}
              onClick={() => {
                setActiveLayer(p.id);
                setShowLeftSidebar(false);
              }}
              className={`px-4 py-1.5 flex items-center gap-2 cursor-pointer text-sm group transition-colors ${
                activeLayer === p.id 
                  ? "bg-[#383838] text-white" 
                  : "text-[#d4d4d4] hover:bg-[#333]"
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[12px] truncate flex-1">{p.name}</span>
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setPhotos(photos.filter(x => x.id !== p.id));
                  if (activeLayer === p.id) setActiveLayer("camera");
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-[#888] transition-opacity"
                title="Hapus Foto"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* CENTER PANEL: Canvas Area */}
      <div className="flex-1 bg-[#1e1e1e] flex flex-col relative overflow-hidden">
        {/* Top Toolbar */}
        <div className="h-10 border-b border-[#111] flex items-center justify-between px-3 bg-[#2c2c2c] shrink-0">
          {/* Left Menu Button for Mobile */}
          <button 
            onClick={() => {
              setShowLeftSidebar(true);
              setShowRightSidebar(false);
            }} 
            className="md:hidden p-1.5 rounded-[3px] text-[#888] hover:text-[#ccc] hover:bg-[#2a2a2a] transition-colors flex items-center gap-1"
            title="Tampilkan Layers"
          >
            <Menu className="h-4 w-4" />
            <span className="text-[10px] font-medium">Layers</span>
          </button>
          <div className="hidden md:block w-16" />

          {/* Center Info Text */}
          <div className="flex-1 text-center truncate px-2">
            {activeLayer === "camera" && cameraActive ? (
               <span className="text-[11px] font-medium text-[#888] hidden sm:inline">Mode Kamera Aktif - Tekan tombol bulat di bawah layar untuk memotret</span>
            ) : activePhotoObj ? (
               <span className="text-[11px] font-medium text-[#888] hidden sm:inline">Preview Mode: {activePhotoObj.name}</span>
            ) : null}
            {activeLayer === "camera" && cameraActive ? (
               <span className="text-[11px] font-medium text-[#888] sm:hidden">Mode Kamera Aktif</span>
            ) : activePhotoObj ? (
               <span className="text-[11px] font-medium text-[#888] sm:hidden">Preview: {activePhotoObj.name}</span>
            ) : null}
          </div>

          {/* Right Properties Button for Mobile */}
          <button 
            onClick={() => {
              setShowRightSidebar(true);
              setShowLeftSidebar(false);
            }} 
            className="md:hidden p-1.5 rounded-[3px] text-[#888] hover:text-[#ccc] hover:bg-[#2a2a2a] transition-colors flex items-center gap-1"
            title={activeLayer === "camera" ? "Tampilkan Design" : "Tampilkan Export"}
          >
            <span className="text-[10px] font-medium">{activeLayer === "camera" ? "Design" : "Export"}</span>
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <div className="hidden md:block w-16" />
        </div>

        {/* Canvas Workspace */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-4 md:p-8 bg-[#1e1e1e]">
          <div className="flex flex-col items-center gap-4 max-h-full max-w-full">
            <div 
              className={`relative w-fit mx-auto ${
                (activeLayer === "camera" && !cameraActive) 
                  ? "bg-transparent" 
                  : "shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)] bg-black"
              }`} 
              style={{ maxHeight: '100%', maxWidth: '100%' }}
            >
            
            {/* The Live Camera Area (Always mounted so stream doesn't break) */}
            <div className={activeLayer === "camera" ? "relative w-fit mx-auto" : "hidden"}>
                
                {/* Manual Permission Screen */}
                {!cameraActive && !cameraError && (
                   <div className="flex flex-col items-center bg-[#2c2c2c] p-6 sm:p-8 rounded-[6px] border border-[#383838] shadow-2xl w-full max-w-[320px]">
                     <Camera className="h-10 w-10 text-[#888] mb-4" />
                     <p className="text-white text-sm font-medium mb-1">Akses Diperlukan</p>
                     <p className="text-[#888] text-[11px] mb-6 text-center leading-relaxed">Aplikasi ini membutuhkan akses Kamera dan Lokasi (GPS) untuk berfungsi dengan baik.</p>
                     <button onClick={startCamera} className="px-6 py-2 bg-[#0f8bfd] hover:bg-[#0d7be0] rounded-[3px] text-xs font-medium text-white transition-colors shadow-lg w-full">
                       Izinkan Akses
                     </button>
                   </div>
                )}

                {/* Camera Error Screen */}
                {!cameraActive && cameraError && (
                   <div className="flex flex-col items-center bg-[#2c2c2c] p-6 sm:p-8 rounded-[6px] border border-[#383838] shadow-2xl w-full max-w-[320px]">
                     <Camera className="h-10 w-10 text-red-500 mb-4" />
                     <p className="text-red-400 text-sm font-medium mb-1">{cameraError}</p>
                     <p className="text-[#888] text-[11px] mb-6 text-center leading-relaxed">Mohon klik ikon gembok 🔒 di samping URL browser, ubah izin Kamera & Lokasi menjadi &quot;Allow&quot;, lalu tekan tombol di bawah.</p>
                     <button onClick={startCamera} className="px-6 py-2 bg-[#0f8bfd] hover:bg-[#0d7be0] rounded-[3px] text-xs font-medium text-white transition-colors shadow-lg w-full">
                       Coba Lagi
                     </button>
                   </div>
                )}
 
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className={`max-h-[70vh] md:max-h-[75vh] w-auto max-w-full block transform scale-x-[-1] ${!cameraActive ? 'hidden' : 'opacity-100'}`}
                  style={{ filter: FILTER_PRESETS.find(f => f.value === colorFilter)?.css || "none" }}
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Live Watermark HTML Overlay using calculated videoScale */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden" 
                       style={{ 
                         padding: `${(parseInt(fontSize) * 1.5) * videoScale}px`,
                       }}>
                  {designPreset === "map_card" ? (
                    <div 
                      className="absolute flex items-center pointer-events-none bg-[rgba(15,15,15,0.45)] border border-[rgba(255,255,255,0.15)] rounded-[8px] shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-md"
                      style={{
                        padding: `${12 * videoScale}px`,
                        gap: `${12 * videoScale}px`,
                        fontFamily: fontFamily,
                        
                        // Positioning logic
                        top: alignY === "top" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignY === "center" ? "50%" : "auto"),
                        bottom: alignY === "bottom" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        transform: alignY === "center" ? "translateY(-50%)" : "none",
                        
                        left: alignX === "left" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignX === "center" ? "50%" : "auto"),
                        right: alignX === "right" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        ...(alignX === "center" ? { transform: `${alignY === "center" ? "translate(-50%, -50%)" : "translateX(-50%)"}` } : {}),
                      }}
                    >
                      {/* Left side: Map */}
                      <div
                        className="shrink-0 rounded-[6px] overflow-hidden border border-[rgba(255,255,255,0.18)] bg-[#121212] flex items-center justify-center relative shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25)]"
                        style={{
                          width: `${MAP_CARD_W * videoScale}px`,
                          height: `${MAP_CARD_H * videoScale}px`,
                        }}
                      >
                        {mapDataUrl ? (
                          <img src={mapDataUrl} alt="Map" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center p-1">
                            <div className="animate-spin rounded-full h-3 w-3 border border-[#888] border-t-transparent mb-1" />
                            <span className="text-[7px] text-[#555] font-mono">LOADING MAP</span>
                          </div>
                        )}
                      </div>

                      {/* Right side: Info */}
                      <div className="flex flex-col justify-between" style={{ height: `${MAP_CARD_H * videoScale}px`, width: `${260 * videoScale}px` }}>
                        {/* Address */}
                        <div
                          className="text-[#f0f0f0] font-medium leading-tight overflow-hidden"
                          style={{
                            fontSize: `${13 * videoScale}px`,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {manualLocation || gpsAddress || "Mencari Lokasi GPS..."}
                        </div>

                        <div className="flex flex-col font-mono text-[#888]">
                          {/* Time */}
                          <span style={{ fontSize: `${10 * videoScale}px` }}>
                            {getDisplayTime().toLocaleString("en-GB")}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : designPreset === "dark_card" ? (
                    <div 
                      className="absolute flex flex-col pointer-events-none bg-[rgba(15,15,15,0.45)] border border-[rgba(255,255,255,0.15)] rounded-[6px] shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-md"
                      style={{
                        padding: `${12 * videoScale}px`,
                        fontFamily: fontFamily,
                        fontWeight: fontWeight,
                        fontSize: `${parseInt(fontSize) * videoScale}px`,
                        color: fillColor,
                        lineHeight: 1.2,
                        textAlign: "left",
                        
                        // Positioning logic based on alignX and alignY
                        top: alignY === "top" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignY === "center" ? "50%" : "auto"),
                        bottom: alignY === "bottom" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        transform: alignY === "center" ? "translateY(-50%)" : "none",
                        
                        left: alignX === "left" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignX === "center" ? "50%" : "auto"),
                        right: alignX === "right" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        ...(alignX === "center" ? { transform: `${alignY === "center" ? "translate(-50%, -50%)" : "translateX(-50%)"}` } : {}),
                      }}
                    >
                      {getWatermarkLines().map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </div>
                  ) : designPreset === "minimal_badge" ? (
                    <div
                      className="absolute flex items-center pointer-events-none bg-[rgba(15,15,15,0.6)] border border-[rgba(255,255,255,0.18)] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-md"
                      style={{
                        padding: `${8 * videoScale}px ${14 * videoScale}px`,
                        gap: `${8 * videoScale}px`,
                        fontFamily: fontFamily,

                        top: alignY === "top" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignY === "center" ? "50%" : "auto"),
                        bottom: alignY === "bottom" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        transform: alignY === "center" ? "translateY(-50%)" : "none",

                        left: alignX === "left" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignX === "center" ? "50%" : "auto"),
                        right: alignX === "right" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        ...(alignX === "center" ? { transform: `${alignY === "center" ? "translate(-50%, -50%)" : "translateX(-50%)"}` } : {}),
                      }}
                    >
                      <span className="rounded-full bg-[#22c55e] shrink-0" style={{ width: `${6 * videoScale}px`, height: `${6 * videoScale}px` }} />
                      <span style={{ fontSize: `${13 * videoScale}px`, fontWeight: 600, color: fillColor }}>
                        {getDisplayTime().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ) : designPreset === "film_strip" ? (
                    <div
                      className="absolute inset-x-0 flex items-center pointer-events-none bg-[rgba(10,10,10,0.75)]"
                      style={{
                        height: `${44 * videoScale}px`,
                        top: alignY === "top" ? 0 : "auto",
                        bottom: alignY !== "top" ? 0 : "auto",
                        backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.35) 0, rgba(255,255,255,0.35) ${10 * videoScale}px, transparent ${10 * videoScale}px, transparent ${32 * videoScale}px)`,
                        backgroundPosition: `${11 * videoScale}px center`,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: `calc(100% - ${22 * videoScale}px) ${10 * videoScale}px`,
                        justifyContent: alignX === "left" ? "flex-start" : (alignX === "right" ? "flex-end" : "center"),
                        padding: `0 ${(parseInt(fontSize) * 1.5) * videoScale}px`,
                      }}
                    >
                      <span className="font-mono font-semibold text-[#ff7700]" style={{ fontSize: `${14 * videoScale}px` }}>
                        {template === "location_only" ? (manualLocation || gpsAddress || "") : getDisplayTime().toLocaleString("en-GB")}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="absolute flex flex-col pointer-events-none"
                      style={{
                        fontFamily: fontFamily,
                        fontWeight: fontWeight,
                        fontSize: `${parseInt(fontSize) * videoScale}px`,
                        color: fillColor,
                        WebkitTextStroke: hasStroke ? `${Math.max(1, (parseInt(fontSize) / 15)) * videoScale}px ${strokeColor}` : undefined,
                        lineHeight: 1.2,
                        textAlign: alignX,
                        
                        // Positioning logic based on alignX and alignY
                        top: alignY === "top" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignY === "center" ? "50%" : "auto"),
                        bottom: alignY === "bottom" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        transform: alignY === "center" ? "translateY(-50%)" : "none",
                        
                        left: alignX === "left" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : (alignX === "center" ? "50%" : "auto"),
                        right: alignX === "right" ? `${(parseInt(fontSize) * 1.5) * videoScale}px` : "auto",
                        ...(alignX === "center" ? { transform: `${alignY === "center" ? "translate(-50%, -50%)" : "translateX(-50%)"}` } : {}),
                      }}
                    >
                      {getWatermarkLines().map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
                )}
                             {/* Countdown Overlay */}
                {isCountingDown && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-xs z-30 transition-all">
                    <div className="text-white text-8xl font-bold font-mono animate-bounce drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                      {countdownValue}
                    </div>
                  </div>
                )}

                {/* Shutter Flash Overlay */}
                {showFlash && (
                  <div className="absolute inset-0 bg-white z-40 transition-opacity duration-150 opacity-100" />
                )}
            </div>
 
            {/* Photo Preview Area */}
            {activeLayer !== "camera" && activePhotoObj && (
              <img src={activePhotoObj.url} alt="Preview" className="max-h-[70vh] md:max-h-[75vh] w-auto max-w-full block" />
            )}

            {activeLayer !== "camera" && !activePhotoObj && (
              <div className="text-sm text-neutral-500">No layer selected</div>
            )}
          </div>

          {/* Shutter and Timer Control Bar */}
          {activeLayer === "camera" && cameraActive && (
            <div className="bg-[#2c2c2c] border border-[#383838] px-4 py-2.5 rounded-full flex flex-wrap items-center justify-center gap-3 sm:gap-4 shadow-lg z-20 transition-all select-none">
              
              {/* Timer Control Group */}
              <div className="flex items-center gap-2 pr-3 sm:pr-4 border-r border-[#383838]">
                <span className="text-[10px] text-[#888] font-semibold uppercase tracking-wider">Timer:</span>
                <div className="flex bg-[#1e1e1e] p-0.5 rounded-[4px] border border-[#333]">
                  <button 
                    onClick={() => { setTimerDuration(0); setIsCustomTimer(false); }}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-[3px] transition-colors ${timerDuration === 0 && !isCustomTimer ? "text-white bg-[#404040]" : "text-[#888] hover:text-white"}`}
                  >
                    Off
                  </button>
                  <button 
                    onClick={() => { setTimerDuration(3); setIsCustomTimer(false); }}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-[3px] transition-colors ${timerDuration === 3 && !isCustomTimer ? "text-white bg-[#404040]" : "text-[#888] hover:text-white"}`}
                  >
                    3s
                  </button>
                  <button 
                    onClick={() => { setTimerDuration(5); setIsCustomTimer(false); }}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-[3px] transition-colors ${timerDuration === 5 && !isCustomTimer ? "text-white bg-[#404040]" : "text-[#888] hover:text-white"}`}
                  >
                    5s
                  </button>
                  <button 
                    onClick={() => { setIsCustomTimer(true); }}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-[3px] transition-colors ${isCustomTimer ? "text-white bg-[#404040]" : "text-[#888] hover:text-white"}`}
                  >
                    Custom
                  </button>
                </div>

                {isCustomTimer && (
                  <div className="flex items-center gap-1 bg-[#1e1e1e] border border-[#444] rounded-[3px] px-1 py-0.5 w-14 focus-within:border-[#a855f7] transition-colors">
                    <input 
                      type="text" 
                      value={customTimerInput} 
                      onChange={e => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setCustomTimerInput(val);
                        setTimerDuration(parseInt(val) || 0);
                      }}
                      className="bg-transparent text-[10px] text-center w-full outline-none text-white font-semibold"
                      placeholder="detik"
                    />
                    <span className="text-[9px] text-[#555] font-semibold">s</span>
                  </div>
                )}
              </div>

              {/* Shutter Capture Button */}
              <button 
                onClick={startCaptureWithTimer}
                disabled={isCountingDown}
                className={`h-11 w-11 rounded-full flex items-center justify-center transition-all ${
                  isCountingDown 
                    ? 'bg-red-500/20 border-2 border-red-500 cursor-not-allowed scale-95' 
                    : 'bg-white/10 border-2 border-white hover:bg-white/20 active:scale-95 shadow-[0_4px_12px_rgba(0,0,0,0.3)]'
                }`}
                title="Ambil Foto"
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center shadow-sm transition-all ${isCountingDown ? 'bg-red-500 animate-pulse' : 'bg-white'}`}>
                  <Camera className={`h-4 w-4 transition-colors ${isCountingDown ? 'text-white' : 'text-black'}`} />
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Backdrop for Right Sidebar on Mobile */}
      {showRightSidebar && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-20 md:hidden" 
          onClick={() => setShowRightSidebar(false)}
        />
      )}

      {/* RIGHT PANEL: Figma Properties & Canva Export */}
      <div className={`fixed md:relative inset-y-0 right-0 w-[240px] bg-[#2c2c2c] border-l border-[#111] flex flex-col shrink-0 shadow-lg z-30 overflow-y-auto transition-transform duration-300 md:translate-x-0 ${showRightSidebar ? "translate-x-0" : "translate-x-full"}`}>
        {activeLayer === "camera" ? (
          <>
            <div className="h-10 flex items-center justify-between px-4 border-b border-[#111] shrink-0">
              <span className="text-[11px] font-semibold text-white">Design</span>
              <button 
                onClick={() => setShowRightSidebar(false)} 
                className="md:hidden p-1 text-[#888] hover:text-white transition-colors"
                title="Tutup Design"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

        {/* Section: Presets */}
        <div className="border-b border-[#111] py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Preset Template</span>
          </div>
          <div className="px-4 space-y-2">
            <FigmaSelect 
              value={designPreset} 
              onChange={(val) => {
                setDesignPreset(val);
                if (val === "retro") {
                  setFontFamily("system-ui");
                  setFontWeight("700");
                  setFillColor("#ff7700");
                  setHasStroke(true);
                  setStrokeColor("#000000");
                } else if (val === "dark_card") {
                  setFillColor("#ffffff");
                  setHasStroke(false);
                } else if (val === "map_card") {
                  setFillColor("#ffffff");
                  setHasStroke(false);
                } else if (val === "standard") {
                  setFillColor("#000000");
                  setHasStroke(false);
                } else if (val === "minimal_badge") {
                  setFillColor("#ffffff");
                  setHasStroke(false);
                } else if (val === "film_strip") {
                  setFillColor("#ff7700");
                  setHasStroke(false);
                }
              }}
              options={[
                {label: "Standard (Teks Saja)", value: "standard"},
                {label: "Classic Retro (Kamera Analog)", value: "retro"},
                {label: "Glassy Dark Card (Latar Belakang)", value: "dark_card"},
                {label: "GPS Map Card (Visual Lokasi)", value: "map_card"},
                {label: "Minimal Badge (Pill Kecil)", value: "minimal_badge"},
                {label: "Film Strip (Bilah Bawah)", value: "film_strip"},
              ]}
            />
          </div>
        </div>

        {/* Section: Color Filter */}
        <div className="border-b border-[#111] py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Filter Warna</span>
          </div>
          <div className="px-4">
            <FigmaSelect
              value={colorFilter}
              onChange={setColorFilter}
              options={FILTER_PRESETS.map(f => ({ label: f.label, value: f.value }))}
            />
          </div>
        </div>

        {/* Section: Typography */}
        <div className="border-b border-[#111] py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Typography</span>
          </div>
          
          <div className="px-4 space-y-2">
            <FigmaSelect 
              value={fontFamily} 
              onChange={setFontFamily}
              options={[
                {label: "Inter", value: "Inter"},
                {label: "Roboto", value: "Roboto"},
                {label: "Arial", value: "Arial"},
                {label: "Times New Roman", value: "Times New Roman"},
                {label: "System UI", value: "system-ui"},
              ]}
            />
            
            <div className="flex gap-2">
              <FigmaSelect 
                className="flex-1"
                value={fontWeight} 
                onChange={setFontWeight}
                options={[
                  {label: "Regular", value: "400"},
                  {label: "Medium", value: "500"},
                  {label: "Bold", value: "700"},
                  {label: "Black", value: "900"},
                ]}
              />
              <div className="w-[60px]">
                <div className="flex-1 flex items-center gap-2 bg-[#2c2c2c] border border-[#444] rounded-[3px] px-2 py-1 focus-within:border-[#18a0fb] transition-colors">
                  <Type className="h-3 w-3 text-[#888]" />
                  <input 
                    type="text" 
                    value={fontSize} 
                    onChange={e => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setFontSize(val);
                    }}
                    className="bg-transparent text-[11px] w-full outline-none text-white"
                    placeholder="32"
                  />
                </div>
              </div>
            </div>

            {/* Alignment Row */}
            <div className="flex items-center gap-1 mt-2">
              <div className="flex bg-[#1e1e1e] rounded-[3px] p-0.5 border border-transparent">
                <FigmaIconButton icon={AlignLeft} active={alignX === "left"} onClick={() => setAlignX("left")} />
                <FigmaIconButton icon={AlignCenter} active={alignX === "center"} onClick={() => setAlignX("center")} />
                <FigmaIconButton icon={AlignRight} active={alignX === "right"} onClick={() => setAlignX("right")} />
              </div>
              <div className="w-1 h-3 border-l border-[#444] mx-1"></div>
              <div className="flex bg-[#1e1e1e] rounded-[3px] p-0.5 border border-transparent">
                <FigmaIconButton icon={AlignVerticalJustifyStart} active={alignY === "top"} onClick={() => setAlignY("top")} />
                <FigmaIconButton icon={AlignVerticalJustifyCenter} active={alignY === "center"} onClick={() => setAlignY("center")} />
                <FigmaIconButton icon={AlignVerticalJustifyEnd} active={alignY === "bottom"} onClick={() => setAlignY("bottom")} />
              </div>
            </div>
          </div>
        </div>

        {/* Section: Fill */}
        <div className="border-b border-[#111] py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Fill</span>
          </div>
          <div className="px-4 flex items-center gap-2">
            <div className="relative w-5 h-5 rounded-[2px] overflow-hidden border border-[#444]">
              <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)} className="absolute -inset-2 w-10 h-10 cursor-pointer" />
            </div>
            <FigmaInput value={fillColor} onChange={setFillColor} />
            <span className="text-[10px] text-[#888] w-8">100%</span>
          </div>
        </div>

        {/* Section: Stroke */}
        <div className="border-b border-[#111] py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Stroke</span>
            <button onClick={() => setHasStroke(!hasStroke)} className="text-[#888] hover:text-white">
              {hasStroke ? <span className="text-lg leading-none">-</span> : <span className="text-lg leading-none">+</span>}
            </button>
          </div>
          {hasStroke && (
            <div className="px-4 flex items-center gap-2">
              <div className="relative w-5 h-5 rounded-[2px] overflow-hidden border border-[#444]">
                <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)} className="absolute -inset-2 w-10 h-10 cursor-pointer" />
              </div>
              <FigmaInput value={strokeColor} onChange={setStrokeColor} />
            </div>
          )}
        </div>

        {/* Section: Content Details */}
        <div className="py-3">
          <div className="px-4 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">Watermark Content</span>
          </div>
          <div className="px-4 space-y-2">
            <div className="text-[10px] text-[#888] mb-1">Template Style</div>
            <FigmaSelect 
              value={template} 
              onChange={setTemplate}
              options={[
                {label: "Standard (Date & Loc)", value: "standard"},
                {label: "Minimal (Time only)", value: "minimal"},
                {label: "Location Only", value: "location_only"},
              ]}
            />
            
            <div className="text-[10px] text-[#888] mb-1 mt-3">Manual Location Override</div>
            <FigmaInput
              value={manualLocation}
              onChange={setManualLocation}
              placeholder="e.g. Jakarta, ID"
            />

            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-[#888]">Edit Tanggal & Jam Manual</span>
              <div
                onClick={() => setUseManualDateTime(!useManualDateTime)}
                className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${useManualDateTime ? "bg-[#8b3dff]" : "bg-[#444] hover:bg-[#555]"}`}
              >
                <div className={`absolute top-[2px] w-3 h-3 rounded-full transition-all ${useManualDateTime ? "right-[2px] bg-white" : "left-[2px] bg-[#888]"}`}></div>
              </div>
            </div>
            {useManualDateTime && (
              <div className="relative flex items-center bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-transparent hover:border-[#444] rounded-[3px] transition-colors focus-within:border-[#0f8bfd] focus-within:bg-[#1e1e1e]">
                <input
                  type="datetime-local"
                  step="1"
                  value={manualDateTime}
                  onChange={e => setManualDateTime(e.target.value)}
                  className="w-full bg-transparent text-[11px] text-[#e0e0e0] px-2 py-1 outline-none placeholder:text-[#555] [color-scheme:dark]"
                />
              </div>
            )}
          </div>
        </div>
        </>
        ) : activePhotoObj ? (
          <>
            <div className="h-10 flex items-center justify-between px-4 border-b border-[#111] shrink-0">
              <span className="text-[11px] font-semibold text-white">Export setting</span>
              <button 
                onClick={() => setShowRightSidebar(false)} 
                className="md:hidden p-1 text-[#888] hover:text-white transition-colors"
                title="Tutup Export"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            
            <div className="p-4 flex flex-col gap-6 flex-1">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-white">Size</span>
                  <span className="text-[10px] text-[#888]">1,920 × 1,080 px</span>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-[11px] font-semibold text-white">Quality</span>
                </div>
                {/* Segmented Control */}
                <div className="bg-[#1e1e1e] p-1 flex rounded-[6px] border border-[#333]">
                  <button onClick={() => setExportQuality("SD")} className={`flex-1 py-1.5 text-[11px] font-medium rounded-[4px] transition-colors ${exportQuality === "SD" ? "text-white bg-[#404040] shadow-sm" : "text-[#888] hover:text-[#d4d4d4]"}`}>SD</button>
                  <button onClick={() => setExportQuality("HD")} className={`flex-1 py-1.5 text-[11px] font-medium rounded-[4px] transition-colors ${exportQuality === "HD" ? "text-white bg-[#404040] shadow-sm" : "text-[#888] hover:text-[#d4d4d4]"}`}>HD</button>
                  <button onClick={() => setExportQuality("MAX")} className={`flex-1 py-1.5 text-[11px] font-medium rounded-[4px] transition-colors ${exportQuality === "MAX" ? "text-white bg-[#404040] shadow-sm" : "text-[#888] hover:text-[#d4d4d4]"}`}>MAX</button>
                </div>
              </div>

              
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#d4d4d4]">Save download settings</span>
                <div onClick={() => setExportSaveSettings(!exportSaveSettings)} className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${exportSaveSettings ? "bg-[#8b3dff]" : "bg-[#444] hover:bg-[#555]"}`}>
                  <div className={`absolute top-[2px] w-3 h-3 rounded-full transition-all ${exportSaveSettings ? "right-[2px] bg-white" : "left-[2px] bg-[#888]"}`}></div>
                </div>
              </div>

              <div className="bg-[#594218]/40 border border-[#594218] p-3 rounded-md mt-2 relative">
                <p className="text-[10.5px] text-[#e0cfb8] leading-relaxed relative z-10">
                  <strong className="text-white">{exportQuality} Selected.</strong> 
                  <br/><br/>
                  {exportQuality === "MAX" ? "Exporting in MAX resolution ensures your photo and watermark remain exactly 1:1 original without any compression." : `Exporting in ${exportQuality} will apply standard compression to reduce file size.`}
                </p>
              </div>

              <div className="mt-auto pt-4 pb-2">
                <button 
                  onClick={async () => {
                    const img = new window.Image();
                    img.src = activePhotoObj.url;
                    await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); });

                    const canvas = document.createElement("canvas");
                    let scale = 1;
                    if (exportQuality === "SD") scale = 0.5;
                    if (exportQuality === "HD") scale = 0.75;
                    // MAX keeps scale = 1
                    canvas.width = img.naturalWidth * scale;
                    canvas.height = img.naturalHeight * scale;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return;
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    // Always re-encode through a fresh canvas to strip any residual metadata
                    const qual = exportQuality === "SD" ? 0.6 : (exportQuality === "HD" ? 0.8 : 0.95);
                    const cleanUrl = canvas.toDataURL("image/jpeg", qual);

                    const link = document.createElement("a");
                    link.download = `${activePhotoObj.name}.jpg`;
                    link.href = cleanUrl;
                    link.click();
                  }}
                  className="w-full py-2.5 bg-[#8b3dff] hover:bg-[#7b2dee] text-white text-[13px] font-semibold rounded-[8px] transition-colors shadow-sm"
                >
                  Download
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
