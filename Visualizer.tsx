
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    const bars = 24;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#a855f7');
      gradient.addColorStop(1, '#06b6d4');
      ctx.fillStyle = gradient;
      
      for (let i = 0; i < bars; i++) {
        const height = (0.3 + Math.random() * 0.7) * canvas.height * 0.8;
        const x = (canvas.width / bars) * i;
        const y = (canvas.height - height) / 2;
        ctx.beginPath();
        ctx.roundRect(x + 1.5, y, (canvas.width / bars) - 3, height, 4);
        ctx.fill();
      }
      animationFrame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrame);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <canvas 
      ref={canvasRef} 
      width={160} 
      height={32} 
      className="mx-auto opacity-80"
    />
  );
};

export default Visualizer;
