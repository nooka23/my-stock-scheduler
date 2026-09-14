import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: permitted, error: permissionError } = await supabase.rpc('wiki_is_owner');
  if (permissionError || permitted !== true) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { id } = await params;
  const { data: attachment, error } = await supabase.from('wiki_attachments')
    .select('storage_path, mime_type, original_filename').eq('id', id).single();
  if (error || !attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: file, error: downloadError } = await supabase.storage.from('wiki-private').download(attachment.storage_path);
  if (downloadError || !file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(file.stream(), { headers: {
    'Content-Type': attachment.mime_type,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_filename)}`,
    'Cache-Control': 'private, no-store',
  } });
}
