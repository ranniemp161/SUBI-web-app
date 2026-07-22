"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
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
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-xs font-bold tracking-wider uppercase mb-4">
          <Sparkles className="w-4 h-4" />
          Executive Application
        </div>

        <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-4">
          Schedule Your Mentorship Strategy Call
        </h1>

        <p className="text-gray-400 text-base md:text-lg">
          Please fill out the quick application below. We limit mentorship cohorts to ensure 1-on-1 strategic focus with every founder.
        </p>
      </div>

      {submitted ? (
        <div className="glass-panel p-10 md:p-14 rounded-3xl border border-yellow-400/40 text-center max-w-2xl mx-auto space-y-6 shadow-[0_0_50px_rgba(255,255,0,0.15)]">
          <div className="w-20 h-20 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center text-yellow-400 mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <h2 className="text-3xl font-extrabold text-white">
            Application Received!
          </h2>

          <p className="text-gray-300 text-base leading-relaxed">
            Thank you, <span className="text-yellow-400 font-semibold">{formData.fullName}</span>. Our team is reviewing your details and will get back to you at <span className="text-white font-mono">{formData.email}</span> within 24 hours to schedule your call.
          </p>

          <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-400" /> Response within 24 hours
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-yellow-400" /> Executive Confidentiality Guaranteed
            </span>
          </div>

          <div className="pt-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-yellow-400 hover:text-white transition-colors"
            >
              ← Return to Mentorship Overview
            </Link>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-8 md:p-12 rounded-3xl border border-white/10 shadow-2xl relative">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* FULL NAME */}
              <div className="space-y-2">
                <label htmlFor="fullName" className="block text-sm font-semibold text-gray-200">
                  Full Name <span className="text-yellow-400">*</span>
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  placeholder="e.g. Alex Morgan"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm"
                />
              </div>

              {/* EMAIL ADDRESS */}
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-semibold text-gray-200">
                  Work Email <span className="text-yellow-400">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="alex@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* COMPANY NAME */}
              <div className="space-y-2">
                <label htmlFor="companyName" className="block text-sm font-semibold text-gray-200">
                  Company / Business Name <span className="text-yellow-400">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  required
                  placeholder="e.g. Kenganda Media"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm"
                />
              </div>

              {/* REVENUE STAGE */}
              <div className="space-y-2">
                <label htmlFor="revenueStage" className="block text-sm font-semibold text-gray-200">
                  Current Monthly Revenue <span className="text-yellow-400">*</span>
                </label>
                <select
                  id="revenueStage"
                  value={formData.revenueStage}
                  onChange={(e) => setFormData({ ...formData, revenueStage: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm cursor-pointer"
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
                Primary Goal for YouTube &amp; Personal Branding <span className="text-yellow-400">*</span>
              </label>
              <input
                id="brandingGoal"
                type="text"
                required
                placeholder="e.g. Build founder authority, generate organic client leads, launch a channel"
                value={formData.brandingGoal}
                onChange={(e) => setFormData({ ...formData, brandingGoal: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm"
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
                className="w-full px-4 py-3 rounded-xl bg-[#141419] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all text-sm resize-none"
              />
            </div>

            {/* SUBMIT BUTTON */}
            <div className="pt-4 text-center">
              <button
                type="submit"
                disabled={loading}
                className="btn-animated text-base px-8 py-3.5 w-full sm:w-auto justify-center"
              >
                {loading ? "Submitting..." : "Submit Application & Book Call"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-yellow-400" />
              <span>Your privacy is protected. We never share your information.</span>
            </div>
            <Link href="/privacy" className="hover:text-yellow-400 underline transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
