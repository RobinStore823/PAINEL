-- JÁ APLICADO NO SUPABASE ATUAL. NÃO EXECUTAR NOVAMENTE NO MESMO PROJETO.
-- Biblioteca privada para guardar o PDF-base original, SEM edição automática.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('svd_homologacao_pdf','svd_homologacao_pdf',false,10485760,ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=ARRAY['application/pdf'];

CREATE POLICY "svd_pdf_base_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id='svd_homologacao_pdf' AND (SELECT public.is_admin()));
CREATE POLICY "svd_pdf_base_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id='svd_homologacao_pdf' AND (SELECT public.is_admin()));
CREATE POLICY "svd_pdf_base_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id='svd_homologacao_pdf' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id='svd_homologacao_pdf' AND (SELECT public.is_admin()));
CREATE POLICY "svd_pdf_base_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id='svd_homologacao_pdf' AND (SELECT public.is_admin()));
