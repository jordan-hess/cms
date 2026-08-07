import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { createClient } from '@supabase/supabase-js'
import { verifyPassword } from './password'

function createLookupClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email
        const password = credentials?.password
        if (typeof email !== 'string' || typeof password !== 'string') return null

        const supabase = createLookupClient()
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, full_name, password_hash, is_active')
          .eq('email', email.toLowerCase().trim())
          .single()

        if (!profile || !profile.password_hash || !profile.is_active) return null

        const valid = await verifyPassword(password, profile.password_hash)
        if (!valid) return null

        return { id: profile.id, email: profile.email, name: profile.full_name }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
})

export { GET, POST, auth, signIn, signOut }
