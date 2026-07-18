import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6">
      <div className="glass-panel p-12 rounded-3xl max-w-lg w-full text-center space-y-6">
        <h1 className="text-6xl font-display font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-amber-400">
          404
        </h1>
        <h2 className="text-2xl font-semibold">Page not found</h2>
        <p className="text-gray-400">
          We couldn&apos;t find the page you were looking for. It might have been moved or doesn&apos;t exist.
        </p>
        <div className="pt-4">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 transition-colors text-white px-6 py-3 rounded-full font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
