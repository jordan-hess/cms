import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import CustomerManager from '@/components/customers/CustomerManager'

export default async function CustomersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single()

  const query = supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })

  if (profile?.role !== 'admin') {
    query.eq('created_by', user!.id)
  }

  const { data: customers } = await query

  return (
    <div>
      <Header title="Customers" userId={user!.id} />
      <div className="p-6">
        <CustomerManager customers={customers || []} userId={user!.id} />
      </div>
    </div>
  )
}
