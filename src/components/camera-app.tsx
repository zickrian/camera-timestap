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

export default function CameraApp() {
  // Layers / Photos Cache
  const [photos, setPhotos] = useState<{id: string, url: string, name: string}[]>([]);
  const [exportQuality, setExportQuality] = useState("MAX");
  const [exportSaveSettings, setExportSaveSettings] = useState(true);
  const [activeLayer, setActiveLayer] = useState<string>("camera"); // "camera" or photo id

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

  // Settings State
  const [fontFamily, setFontFamily] = useState("Inter");
  const [fontWeight, setFontWeight] = useState("400");
  const [fontSize, setFontSize] = useState("32"); 
  const [alignX, setAlignX] = useState<"left" | "center" | "right">("right");
  const [alignY, setAlignY] = useState<"top" | "center" | "bottom">("bottom");
  
  const [fillColor, setFillColor] = useState("#ffffff");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [hasStroke, setHasStroke] = useState(true);
  
  const [template, setTemplate] = useState("standard");
  const [manualLocation, setManualLocation] = useState("");
  
  // Data
  const [liveTime, setLiveTime] = useState(new Date());
  const [gpsAddress, setGpsAddress] = useState("");


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
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
          if (res.ok) {
            const data = await res.json();
            setGpsAddress(data.display_name || `Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`);
          }
        } catch {
          // ignore
        }
      },
      () => setGpsAddress("Location denied/unavailable"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

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

  const getWatermarkLines = () => {
    const timeStr = liveTime.toLocaleString("en-GB");
    const locStr = manualLocation || gpsAddress || "Mencari Lokasi GPS...";
    
    const wrappedLoc = wrapText(locStr, 35);
    
    if (template === "minimal") return [timeStr];
    if (template === "location_only") return wrappedLoc;
    return [timeStr, ...wrappedLoc]; // standard
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    // Draw video frame mirrored to match preview
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // Draw Watermark
    const lines = getWatermarkLines();
    const size = parseInt(fontSize) || 32;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}, sans-serif`;
    
    const padding = size * 1.5;
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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const newPhoto = {
      id: Date.now().toString(),
      url: dataUrl,
      name: `Photo ${photos.length + 1}`
    };
    
    setPhotos([newPhoto, ...photos]);
    setActiveLayer(newPhoto.id); // auto switch to preview
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
          <div className="relative shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)] bg-black w-fit mx-auto" style={{ maxHeight: '100%', maxWidth: '100%' }}>
            
            {/* The Live Camera Area (Always mounted so stream doesn't break) */}
            <div className={activeLayer === "camera" ? "relative w-fit mx-auto" : "hidden"}>
                
                {/* Manual Permission Screen */}
                {!cameraActive && !cameraError && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20 p-4">
                     <div className="flex flex-col items-center bg-[#2c2c2c] p-6 sm:p-8 rounded-[6px] border border-[#383838] shadow-2xl w-full max-w-[320px]">
                       <Camera className="h-10 w-10 text-[#888] mb-4" />
                       <p className="text-white text-sm font-medium mb-1">Akses Diperlukan</p>
                       <p className="text-[#888] text-[11px] mb-6 text-center leading-relaxed">Aplikasi ini membutuhkan akses Kamera dan Lokasi (GPS) untuk berfungsi dengan baik.</p>
                       <button onClick={startCamera} className="px-6 py-2 bg-[#0f8bfd] hover:bg-[#0d7be0] rounded-[3px] text-xs font-medium text-white transition-colors shadow-lg w-full">
                         Izinkan Akses
                       </button>
                     </div>
                   </div>
                )}
 
                <video ref={videoRef} autoPlay playsInline className={`max-h-[70vh] md:max-h-[75vh] w-auto max-w-full block transform scale-x-[-1] ${!cameraActive ? 'opacity-0' : 'opacity-100'}`} />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Live Watermark HTML Overlay using calculated videoScale */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden" 
                       style={{ 
                         padding: `${(parseInt(fontSize) * 1.5) * videoScale}px`,
                       }}>
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
                </div>
                )}

                {/* Floating Capture Shutter Button */}
                {cameraActive && (
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20">
                    <button 
                      onClick={capturePhoto} 
                      className="h-14 w-14 rounded-full bg-white/30 border-[3px] border-white flex items-center justify-center hover:bg-white/50 active:scale-90 transition-all shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
                      title="Ambil Foto"
                    >
                      <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                        <Camera className="h-5 w-5 text-black" />
                      </div>
                    </button>
                  </div>
                )}
            </div>
 
            {/* Photo Preview Area */}
            {activeLayer !== "camera" && activePhotoObj && (
              <img src={activePhotoObj.url} alt="Preview" className="max-h-[70vh] md:max-h-[75vh] w-auto max-w-full block" />
            )}

            {activeLayer !== "camera" && !activePhotoObj && (
              <div className="text-sm text-neutral-500">No layer selected</div>
            )}

            {cameraError && activeLayer === "camera" && (
               <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 px-4 text-center z-10">
                 <Camera className="h-8 w-8 text-red-500 mb-2" />
                 <p className="text-red-400 text-sm font-medium mb-1">{cameraError}</p>
                 <p className="text-[#888] text-[11px] mb-4 max-w-xs">Mohon klik ikon gembok 🔒 di samping URL browser, ubah izin Kamera & Lokasi menjadi &quot;Allow&quot;, lalu tekan tombol di bawah.</p>
                 <button onClick={startCamera} className="px-4 py-1.5 bg-[#333] hover:bg-[#444] border border-[#555] rounded-[3px] text-xs text-white transition-colors">
                   Coba Lagi
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
                  onClick={() => {
                    if (exportQuality !== "MAX") {
                       const img = new window.Image();
                       img.onload = () => {
                          const canvas = document.createElement("canvas");
                          let scale = 1;
                          if (exportQuality === "SD") scale = 0.5;
                          if (exportQuality === "HD") scale = 0.75;
                          canvas.width = img.width * scale;
                          canvas.height = img.height * scale;
                          const ctx = canvas.getContext("2d");
                          if (ctx) {
                             ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                             const format = "image/jpeg";
                             const qual = exportQuality === "SD" ? 0.6 : (exportQuality === "HD" ? 0.8 : 1.0);
                             const dlUrl = canvas.toDataURL(format, qual);
                             const link = document.createElement("a");
                             link.download = `${activePhotoObj.name}.jpg`;
                             link.href = dlUrl;
                             link.click();
                          }
                       };
                       img.src = activePhotoObj.url;
                    } else {
                       const link = document.createElement("a");
                       link.download = `${activePhotoObj.name}.jpg`;
                       link.href = activePhotoObj.url;
                       link.click();
                    }
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
