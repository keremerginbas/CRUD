import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { AlertCircle, Home, Zap } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center", 
        background: "linear-gradient(160deg, oklch(0.975 0.008 240) 0%, oklch(0.965 0.012 255) 50%, oklch(0.970 0.006 220) 100%)",
        animation: "bgShift 15s ease-in-out infinite",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes bgShift {
          0%, 100% { background: linear-gradient(160deg, oklch(0.975 0.008 240) 0%, oklch(0.965 0.012 255) 50%, oklch(0.970 0.006 220) 100%); }
          50% { background: linear-gradient(160deg, oklch(0.970 0.006 220) 0%, oklch(0.975 0.008 240) 50%, oklch(0.965 0.012 255) 100%); }
        }
        
        @keyframes float404 {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-20px) scale(1.05); }
        }
        
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 0 0 oklch(0.55 0.24 27)80, 0 24px 80px oklch(0 0 0 / 0.10); }
          50% { box-shadow: 0 0 0 20px oklch(0.55 0.24 27)00, 0 24px 80px oklch(0 0 0 / 0.15); }
        }
        
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        
        @keyframes rotate360 {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .not-found-card {
          width: 100%;
          max-width: 500px;
          margin: 0 1rem;
          background: oklch(1 0 0 / 0.7);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid oklch(1 0 0 / 0.3);
          border-radius: 1.5rem;
          padding: 3rem 2rem;
          box-shadow: 0 24px 80px oklch(0 0 0 / 0.10), 0 0 40px oklch(0.45 0.18 255 / 0.15);
          animation: slideInUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative;
          overflow: hidden;
        }
        
        .not-found-card::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, oklch(0.48 0.20 255)08, transparent 70%);
          animation: rotate360 20s linear infinite;
        }
        
        .not-found-content {
          position: relative;
          z-index: 1;
          text-align: center;
        }
        
        .not-found-icon-wrapper {
          display: flex;
          justify-content: center;
          margin-bottom: 2rem;
        }
        
        .not-found-icon {
          position: relative;
          width: 100px;
          height: 100px;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: float404 3s ease-in-out infinite;
        }
        
        .not-found-icon::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, oklch(0.55 0.24 27), oklch(0.60 0.18 45));
          border-radius: 50%;
          opacity: 0.15;
          animation: glowPulse 2s ease-in-out infinite;
        }
        
        .not-found-icon svg {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          color: oklch(0.55 0.24 27);
          filter: drop-shadow(0 0 12px oklch(0.55 0.24 27)40);
        }
        
        .not-found-404 {
          font-size: 4rem;
          font-weight: 900;
          letter-spacing: -0.04em;
          line-height: 1;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, oklch(0.55 0.24 27), oklch(0.60 0.18 45));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: slideInUp 0.8s ease-out 0.1s both;
        }
        
        .not-found-title {
          font-size: 1.5rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: oklch(0.15 0.01 240);
          margin-bottom: 1rem;
          animation: slideInUp 0.8s ease-out 0.2s both;
        }
        
        .not-found-description {
          font-size: 1rem;
          color: oklch(0.55 0.015 250);
          margin-bottom: 2rem;
          line-height: 1.6;
          animation: slideInUp 0.8s ease-out 0.3s both;
        }
        
        .not-found-button {
          background: linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270));
          color: white;
          border: none;
          padding: 0.875rem 1.75rem;
          border-radius: 0.75rem;
          font-weight: 600;
          font-size: 1rem;
          letter-spacing: -0.01em;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 4px 20px oklch(0.45 0.18 255 / 0.35);
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          animation: slideInUp 0.8s ease-out 0.4s both;
        }
        
        .not-found-button:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 32px oklch(0.45 0.18 255 / 0.5);
        }
        
        .not-found-button:active {
          transform: translateY(-1px);
        }
        
        .floating-elements {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        
        .floating-dot {
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: oklch(0.48 0.20 255);
          opacity: 0.3;
          animation: float404 4s ease-in-out infinite;
        }
        
        .dot-1 { top: 10%; left: 10%; animation-delay: 0s; }
        .dot-2 { top: 20%; right: 15%; animation-delay: 0.5s; }
        .dot-3 { bottom: 20%; left: 20%; animation-delay: 1s; }
        .dot-4 { bottom: 10%; right: 10%; animation-delay: 1.5s; }
      `}</style>

      {/* Floating Elements */}
      <div className="floating-elements">
        <div className="floating-dot dot-1" />
        <div className="floating-dot dot-2" />
        <div className="floating-dot dot-3" />
        <div className="floating-dot dot-4" />
      </div>

      {/* Main Card */}
      <div className="not-found-card">
        <div className="not-found-content">
          {/* Icon */}
          <div className="not-found-icon-wrapper">
            <div className="not-found-icon">
              <AlertCircle />
            </div>
          </div>

          {/* 404 Text */}
          <h1 className="not-found-404">404</h1>

          {/* Title */}
          <h2 className="not-found-title">Sayfa Bulunamadı</h2>

          {/* Description */}
          <p className="not-found-description">
            Üzgünüz, aradığınız sayfa mevcut değil.
            <br />
            Taşınmış veya silinmiş olabilir.
          </p>

          {/* Button */}
          <button className="not-found-button" onClick={handleGoHome}>
            <Home className="w-4 h-4" />
            Ana Sayfaya Dön
          </button>
        </div>
      </div>
    </div>
  );
}
