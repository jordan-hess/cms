-- Fix customer visibility: all authenticated users can see all customers
DROP POLICY IF EXISTS "Agents see their own customers" ON customers;
CREATE POLICY "All users see all customers" ON customers FOR SELECT TO authenticated USING (true);
