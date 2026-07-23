"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import FadeIn from "@/components/FadeIn";
import { Sparkles, CheckCircle2, ArrowRight, ShieldCheck, Clock } from "lucide-react";

export default function ApplicationFormPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    companyName: "",
    revenueStage: "$10k - $50k / month",
    brandingGoal: "",
    additionalInfo: "",
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simulate submission delay
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
    }, 800);
  };

  return (
    <div className="relative overflow-hidden z-0 max-w-4xl mx-auto px-6 pt-12 pb-16">
      {/* AMBIENT FIXED GRADIENTS MATCHING FOUNDER'S FRAME */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-brand/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen z-[-1]" />

      {/* FLOATING ABSTRACT BOXES */}
      <div className="absolute inset-0 pointer-events-none z-[-1] overflow-hidden opacity-60">
        <div className="absolute top-[15%] left-[4%] w-32 h-32 border border-white/10 rounded-2xl rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-br from-white/5 to-transparent animate-float" />
        <div className="absolute top-[60%] right-[6%] w-44 h-44 border border-white/10 rounded-3xl -rotate-[15deg] shadow-[0_0_30px_rgba(255,255,255,0.02)] bg-gradient-to-tl from-white/5 to-transparent animate-float-delayed" />
      </div>

      <FadeIn>
        <div className="text-center max-w-2xl mx-auto mb-10 relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-bold tracking-wider uppercase mb-4 shadow-[0_0_20px_rgba(255,255,0,0.1)]">
            <Sparkles className="w-4 h-4 text-brand" />
            Executive Application
          </div>

          <h1 className="text-3xl md:text-5xl font-heading font-black text-white tracking-tight mb-4">
            Schedule Your Mentorship Strategy Call
          </h1>

          <p className="text-gray-400 text-base md:text-lg">
            Please fill out the quick application below. We limit mentorship cohorts to ensure 1-on-1 strategic focus with every founder.
          </p>
        </div>
      </FadeIn>

      {submitted ? (
        <FadeIn>
          <div className="glass-panel p-10 md:p-14 rounded-3xl border border-brand/40 text-center max-w-2xl mx-auto space-y-6 shadow-[0_0_50px_rgba(255,255,0,0.15)] relative z-10">
            <div className="w-20 h-20 rounded-full bg-brand/20 border border-brand/40 flex items-center justify-center text-brand mx-auto">
              <CheckCircle2 className="w-10 h-10 text-brand" />
            </div>

            <h2 className="text-3xl font-heading font-extrabold text-white">
              Application Received!
            </h2>

            <p className="text-gray-300 text-base leading-relaxed">
              Thank you, <span className="text-brand font-semibold">{formData.fullName}</span>. Our team is reviewing your details and will get back to you at <span className="text-white font-mono">{formData.email}</span> within 24 hours to schedule your call.
            </p>

            <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand" /> Response within 24 hours
              </span>
              <span className="hidden sm:inline">•</span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand" /> Executive Confidentiality Guaranteed
              </span>
            </div>

            <div className="pt-6">
              <Link
                href="/mentorship"
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-white transition-colors"
              >
                ← Return to Mentorship Overview
              </Link>
            </div>
          </div>
        </FadeIn>
      ) : (
        <FadeIn delay={0.1}>
          <div className="glass-panel p-8 md:p-12 rounded-3xl border border-white/10 shadow-2xl relative z-10">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* FULL NAME */}
                <div className="space-y-2">
                  <label htmlFor="fullName" className="block text-sm font-semibold text-gray-200">
                    Full Name <span className="text-brand">*</span>
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    required
                    placeholder="e.g. Alex Morgan"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm"
                  />
                </div>

                {/* EMAIL ADDRESS */}
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-200">
                    Work Email <span className="text-brand">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="alex@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* COMPANY NAME */}
                <div className="space-y-2">
                  <label htmlFor="companyName" className="block text-sm font-semibold text-gray-200">
                    Company / Business Name <span className="text-brand">*</span>
                  </label>
                  <input
                    id="companyName"
                    type="text"
                    required
                    placeholder="e.g. Kenganda Media"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm"
                  />
                </div>

                {/* REVENUE STAGE */}
                <div className="space-y-2">
                  <label htmlFor="revenueStage" className="block text-sm font-semibold text-gray-200">
                    Current Monthly Revenue <span className="text-brand">*</span>
                  </label>
                  <select
                    id="revenueStage"
                    value={formData.revenueStage}
                    onChange={(e) => setFormData({ ...formData, revenueStage: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm cursor-pointer"
                  >
                    <option value="Under $10k / month">Under $10k / month</option>
                    <option value="$10k - $50k / month">$10k - $50k / month</option>
                    <option value="$50k - $100k / month">$50k - $100k / month</option>
                    <option value="$100k+ / month">$100k+ / month</option>
                  </select>
                </div>
              </div>

              {/* BRANDING GOAL */}
              <div className="space-y-2">
                <label htmlFor="brandingGoal" className="block text-sm font-semibold text-gray-200">
                  Primary Goal for YouTube &amp; Personal Branding <span className="text-brand">*</span>
                </label>
                <input
                  id="brandingGoal"
                  type="text"
                  required
                  placeholder="e.g. Build founder authority, generate organic client leads, launch a channel"
                  value={formData.brandingGoal}
                  onChange={(e) => setFormData({ ...formData, brandingGoal: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm"
                />
              </div>

              {/* ADDITIONAL INFO */}
              <div className="space-y-2">
                <label htmlFor="additionalInfo" className="block text-sm font-semibold text-gray-200">
                  Anything else we should know before our call? (Optional)
                </label>
                <textarea
                  id="additionalInfo"
                  rows={3}
                  placeholder="Tell us about your current team, channel status, or main challenges..."
                  value={formData.additionalInfo}
                  onChange={(e) => setFormData({ ...formData, additionalInfo: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all text-sm resize-none"
                />
              </div>

              {/* SUBMIT BUTTON */}
              <div className="pt-4 text-center">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-brand via-yellow-400 to-brand text-black font-heading font-bold text-base px-8 py-3.5 rounded-full transition-all hover:scale-105 shadow-[0_0_20px_rgba(255,255,0,0.2)] w-full sm:w-auto justify-center"
                >
                  {loading ? "Submitting..." : "Submit Application & Book Call"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>

            <div className="mt-8 pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand" />
                <span>Your privacy is protected. We never share your information.</span>
              </div>
              <Link href="/privacy" className="hover:text-brand underline transition-colors">
                Privacy Policy
              </Link>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
