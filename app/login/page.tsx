'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft, CheckCircle, ShieldQuestion, UserCog } from 'lucide-react'

type View = 'login' | 'fp-email' | 'fp-security' | 'fp-newpass' | 'fp-newpass-success' | 'fp-admin' | 'fp-admin-sent'

const inputCls = 'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm'
const errorCls = 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  // Login state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Forgot-password state
  const [view, setView] = useState<View>('login')
  const [fpEmail, setFpEmail] = useState('')
  const [fpAnswer, setFpAnswer] = useState('')
  const [fpNewPw, setFpNewPw] = useState('')
  const [fpConfirm, setFpConfirm] = useState('')
  const [fpLoading, setFpLoading] = useState(false)
  const [fpError, setFpError] = useState('')

  function resetFp() {
    setFpEmail(''); setFpAnswer(''); setFpNewPw(''); setFpConfirm('')
    setFpError(''); setFpLoading(false)
    setView('login')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setLoginError(error.message)
      setLoginLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  async function handleMicrosoftLogin() {
    setLoginError('')
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  async function handleSecurityVerify(e: React.FormEvent) {
    e.preventDefault()
    setFpError('')
    if (fpAnswer.trim().toLowerCase() !== 'let it rain') {
      setFpError('Incorrect answer. Please try again.')
      return
    }
    setView('fp-newpass')
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setFpError('')
    if (fpNewPw.length < 8) { setFpError('Password must be at least 8 characters.'); return }
    if (fpNewPw !== fpConfirm) { setFpError('Passwords do not match.'); return }

    setFpLoading(true)
    const res = await fetch('/api/auth/security-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fpEmail, answer: fpAnswer, new_password: fpNewPw }),
    })
    const data = await res.json()
    setFpLoading(false)
    if (!res.ok) { setFpError(data.error || 'Something went wrong.'); return }
    setView('fp-newpass-success')
  }

  async function handleAdminRequest(e: React.FormEvent) {
    e.preventDefault()
    setFpError('')
    setFpLoading(true)
    const res = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fpEmail }),
    })
    const data = await res.json()
    setFpLoading(false)
    if (!res.ok) { setFpError(data.error || 'Something went wrong.'); return }
    setView('fp-admin-sent')
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="hero-shape absolute top-0 left-0 right-0" />
      <div className="w-full max-w-md relative z-10">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8">

          {/* ── Login ── */}
          {view === 'login' && (
            <>
              <div className="flex flex-col items-center mb-8">
                <Image src="/logo.png" width={64} height={64} alt="Social CMS" className="mb-4" />
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Social CMS</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Social Care Management System</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
                </div>
                {loginError && <div className={errorCls}>{loginError}</div>}
                <button type="submit" disabled={loginLoading} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-semibold py-2.5 rounded-lg transition">
                  {loginLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loginLoading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              <button onClick={() => { setFpEmail(email); setFpError(''); setView('fp-email') }} className="mt-4 w-full text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-center transition">
                Forgot password?
              </button>
            </>
          )}

          {/* ── FP: choose method ── */}
          {view === 'fp-email' && (
            <>
              <button onClick={resetFp} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Reset Password</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Enter your email, then choose a reset method.</p>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email address</label>
                <input type="email" required value={fpEmail} onChange={e => setFpEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
              </div>
              {fpError && <div className={`${errorCls} mb-4`}>{fpError}</div>}
              <div className="space-y-3">
                <button
                  onClick={() => { if (!fpEmail) { setFpError('Please enter your email.'); return } setFpError(''); setView('fp-security') }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition text-left group"
                >
                  <div className="bg-blue-100 dark:bg-blue-900/40 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 rounded-lg p-2 transition">
                    <ShieldQuestion className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Answer security question</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Reset your password instantly</p>
                  </div>
                </button>
                <button
                  onClick={() => { if (!fpEmail) { setFpError('Please enter your email.'); return } setFpError(''); setView('fp-admin') }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-xl transition text-left group"
                >
                  <div className="bg-purple-100 dark:bg-purple-900/40 group-hover:bg-purple-200 dark:group-hover:bg-purple-900/60 rounded-lg p-2 transition">
                    <UserCog className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Request admin reset</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">An admin will provide a temporary password</p>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ── FP: security question ── */}
          {view === 'fp-security' && (
            <>
              <button onClick={() => { setFpError(''); setView('fp-email') }} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Security Question</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Answer correctly to reset your password.</p>
              <form onSubmit={handleSecurityVerify} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What is the router&apos;s password?</label>
                  <input required value={fpAnswer} onChange={e => setFpAnswer(e.target.value)} className={inputCls} placeholder="Your answer..." autoComplete="off" />
                </div>
                {fpError && <div className={errorCls}>{fpError}</div>}
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition">
                  Verify Answer
                </button>
              </form>
            </>
          )}

          {/* ── FP: set new password ── */}
          {view === 'fp-newpass' && (
            <>
              <button onClick={() => { setFpError(''); setView('fp-security') }} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Set New Password</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Choose a strong password for <span className="font-medium text-gray-700 dark:text-gray-300">{fpEmail}</span>.</p>
              <form onSubmit={handleNewPassword} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New password</label>
                  <input type="password" required value={fpNewPw} onChange={e => setFpNewPw(e.target.value)} className={inputCls} placeholder="Min. 8 characters" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm new password</label>
                  <input type="password" required value={fpConfirm} onChange={e => setFpConfirm(e.target.value)} className={inputCls} placeholder="Repeat password" />
                </div>
                {fpError && <div className={errorCls}>{fpError}</div>}
                <button type="submit" disabled={fpLoading} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-semibold py-2.5 rounded-lg transition">
                  {fpLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {fpLoading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          {/* ── FP: new password success ── */}
          {view === 'fp-newpass-success' && (
            <div className="text-center py-4">
              <CheckCircle className="w-14 h-14 text-green-500 dark:text-green-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Password Reset</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Your password has been updated. You can now sign in with your new password.</p>
              <button onClick={resetFp} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition">
                Back to Sign In
              </button>
            </div>
          )}

          {/* ── FP: admin request form ── */}
          {view === 'fp-admin' && (
            <>
              <button onClick={() => { setFpError(''); setView('fp-email') }} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Request Admin Reset</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">An admin or team leader will review your request and provide a temporary password.</p>
              <form onSubmit={handleAdminRequest} className="space-y-5">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                  Submitting request for <span className="font-semibold text-gray-900 dark:text-white">{fpEmail}</span>
                </div>
                {fpError && <div className={errorCls}>{fpError}</div>}
                <button type="submit" disabled={fpLoading} className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 dark:disabled:bg-purple-800 text-white font-semibold py-2.5 rounded-lg transition">
                  {fpLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {fpLoading ? 'Submitting...' : 'Submit Request'}
                </button>
              </form>
            </>
          )}

          {/* ── FP: admin request sent ── */}
          {view === 'fp-admin-sent' && (
            <div className="text-center py-4">
              <CheckCircle className="w-14 h-14 text-purple-500 dark:text-purple-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Request Submitted</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Your reset request has been sent to an admin.</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Contact your admin or team leader — they will provide you with a temporary password to log in with.</p>
              <button onClick={resetFp} className="w-full bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white font-semibold py-2.5 rounded-lg transition">
                Back to Sign In
              </button>
            </div>
          )}

        </div>
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">Contact your administrator to get access</p>
      </div>
    </div>
  )
}
