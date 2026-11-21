(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.SVD_CONFIG;
  if (!config?.supabasePublicKey || config.supabasePublicKey.startsWith('COLE_') || !window.supabase) {
    $('config-warning').classList.remove('hidden');
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublicKey);
  const SHEERID_BACKEND = (config.sheeridApiUrl || '/.netlify/functions/sheerid').replace(/\/+$/, '');

  let running = false;
  let refreshing = false;
  let backendOnline = false;

  const PDF_BUCKET = 'svd_homologacao_pdf';
  const PDF_PATH = 'modelos/pdf-base.pdf';
  const pdfStore = client.storage.from(PDF_BUCKET);
  let pdfExists = false;

  function pdfMessage(message, failed = false) {
    const el = $('pdf-base-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = failed ? '#ffb6bb' : '#b8c8d9';
  }

  async function checkBackendHealth() {
    try {
      const res = await fetch(`${SHEERID_BACKEND}/health`);
      const data = await res.json();
      backendOnline = Boolean(res.ok && data.ok);
    } catch {
      backendOnline = false;
    }
    return backendOnline;
  }

  function extractVerificationId(input = '') {
    const m =
      String(input || '').match(/verificationId=([a-fA-F0-9]{24})/i) ||
      String(input || '').match(/([a-fA-F0-9]{24})/);
    return m ? m[1].toLowerCase() : null;
  }

  async function callSheeridApi(path, method = 'GET', body = null) {
    const res = await fetch(`${SHEERID_BACKEND}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro SheerID HTTP ${res.status}`);
    }
    return data;
  }

  async function refreshPDF() {
    const { data, error } = await pdfStore.list('modelos', { limit: 50 });
    if (error) {
      pdfMessage('Biblioteca indisponível: ' + error.message, true);
      return;
    }
    const item = (data || []).find((f) => f.name === 'pdf-base.pdf');
    pdfExists = !!item;
    $('pdf-base-download').disabled = !pdfExists;
    $('pdf-base-remove').disabled = !pdfExists;
    if (item) {
      const date = item.updated_at || item.created_at;
      pdfMessage(
        'PDF-base salvo na biblioteca privada. Última atualização: ' +
          (date ? new Date(date).toLocaleString('pt-BR') : 'data não informada') +
          '. Arquivo original preservado.'
      );
    } else {
      pdfMessage('Nenhum PDF-base cadastrado. Faça upload para guardar seu modelo original.');
    }
  }

  async function downloadPDF() {
    const { data, error } = await pdfStore.download(PDF_PATH);
    if (error) throw new Error(error.message);
    const link = document.createElement('a');
    const url = URL.createObjectURL(data);
    link.href = url;
    link.download = 'pdf-base-original.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const text = (id, s) => ($(id).textContent = s);

  const labels = {
    queued: 'Na fila',
    processing: 'Processando',
    awaiting_authorization: 'Aguardando documento / envio',
    verified: 'Verificado',
    invalid_link: 'Link inválido',
    failed: 'Erro técnico',
    cancelled: 'Cancelado',
    awaiting_provider: 'Em análise no SheerID',
    review_needed: 'Revisão necessária',
  };

  const fmt = (s) => (s ? new Date(s).toLocaleString('pt-BR') : '—');
  const make = (tag, content, className) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  };

  async function call(action, extra = {}) {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Entre novamente.');
    const res = await fetch(`${config.supabaseUrl}/functions/v1/${config.functionName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
        apikey: config.supabasePublicKey,
      },
      body: JSON.stringify({ action, ...extra }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || `Erro HTTP ${res.status}`);
    return body;
  }

  function status(msg, error = false) {
    $('status').textContent = msg;
    $('status').className = 'notice' + (error ? ' danger' : '');
  }

  async function syncSingleJobWithSheerID(job) {
    const sub = job.submissions || {};
    const trackingId = sub.public_id || job.submission_id || job.id;
    const rawUrl = sub.verification_url || job.verification_url || job.link || '';
    const verificationId = sub.verification_id || job.verification_id || extractVerificationId(rawUrl);

    if (!verificationId) {
      throw new Error('Link sem verificationId de 24 caracteres.');
    }

    const current = await callSheeridApi(
      `/verification/${verificationId}?trackingId=${encodeURIComponent(trackingId)}`,
      'GET'
    );
    const step = current.currentStep;

    if (
      step === 'collectStudentPersonalInfo' &&
      sub.first_name &&
      sub.last_name &&
      sub.email &&
      sub.birth_date &&
      sub.organization_id
    ) {
      await callSheeridApi(`/verification/${verificationId}/personal-info`, 'POST', {
        trackingId,
        firstName: sub.first_name,
        lastName: sub.last_name,
        email: sub.email,
        birthDate: sub.birth_date,
        organization: {
          id: Number(sub.organization_id),
          name: sub.organization_name || '',
        },
      });
    }

    if (step === 'docUpload' && pdfExists) {
      const { data: pdfBlob, error: dlErr } = await pdfStore.download(PDF_PATH);
      if (!dlErr && pdfBlob) {
        const arrayBuf = await pdfBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const fileBase64 = btoa(binary);

        await callSheeridApi(`/verification/${verificationId}/document`, 'POST', {
          trackingId,
          fileBase64,
          fileName: 'documento-estudante.pdf',
          mimeType: 'application/pdf',
        });
      }
    }

    const updated = await callSheeridApi(
      `/verification/${verificationId}?trackingId=${encodeURIComponent(trackingId)}`,
      'GET'
    );
    return {
      verificationId,
      currentStep: updated.currentStep,
    };
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await checkBackendHealth();
      const data = await call('list');
      const jobs = data.jobs || [];

      text('s-queued', jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length);
      text('s-processed', jobs.filter((j) => j.status === 'awaiting_authorization' || j.status === 'verified').length);
      text(
        's-other',
        jobs.filter((j) => !['queued', 'processing', 'awaiting_authorization', 'verified'].includes(j.status)).length
      );

      const root = $('jobs');
      root.replaceChildren();

      if (!jobs.length) {
        root.append(make('p', 'Nenhum pedido encontrado. Envie um link pelo site para criar uma solicitação.', 'muted'));
      }

      for (const job of jobs) {
        const div = make('article', undefined, 'job');
        const head = make('div', undefined, 'jobline');
        const title = make('strong', job.submissions?.public_id || job.submission_id);
        const pill = make('span', labels[job.status] || job.status, 'pill');
        head.append(title, pill);
        div.append(head);

        div.append(
          make('div', `Criado: ${fmt(job.created_at)} • Etapa: ${job.stage} • Tentativas: ${job.attempts}`, 'muted')
        );
        if (job.last_error) {
          div.append(make('div', `Código de erro: ${job.last_error}`, 'muted'));
        }

        const actions = make('div', undefined, 'job-actions');

        const syncBtn = make('button', 'Sincronizar SheerID', 'btn primary');
        syncBtn.onclick = async () => {
          syncBtn.disabled = true;
          try {
            status(`Conectando pedido ${job.submissions?.public_id || job.id} ao SheerID...`);
            const result = await syncSingleJobWithSheerID(job);
            status(`SheerID (${result.verificationId}) → Etapa atual: ${result.currentStep}`);
            await refresh();
          } catch (e) {
            status(`Erro SheerID: ${e.message}`, true);
          } finally {
            syncBtn.disabled = false;
          }
        };
        actions.append(syncBtn);

        const evBtn = make('button', 'Histórico', 'btn secondary');
        evBtn.onclick = async () => {
          evBtn.disabled = true;
          try {
            const response = await call('events', { job_id: job.id });
            const content =
              (response.events || []).map((e) => `${fmt(e.created_at)}: ${e.event}`).join('\n') || 'Sem eventos';
            const pre = make('pre', content, 'muted');
            pre.style.whiteSpace = 'pre-wrap';
            div.querySelector('pre')?.remove();
            div.append(pre);
          } catch (e) {
            status(e.message, true);
          } finally {
            evBtn.disabled = false;
          }
        };
        actions.append(evBtn);

        if (!['processing', 'queued'].includes(job.status)) {
          const retry = make('button', 'Recolocar na fila', 'btn outline');
          retry.onclick = async () => {
            if (!confirm('Recolocar este pedido na fila?')) return;
            try {
              await call('retry', { job_id: job.id });
              await refresh();
            } catch (e) {
              status(e.message, true);
            }
          };
          actions.append(retry);
        }

        if (job.status === 'queued' || job.status === 'awaiting_authorization') {
          const cancel = make('button', 'Cancelar robô', 'btn outline');
          cancel.onclick = async () => {
            if (!confirm('Cancelar o processamento interno deste item?')) return;
            try {
              await call('cancel', { job_id: job.id });
              await refresh();
            } catch (e) {
              status(e.message, true);
            }
          };
          actions.append(cancel);
        }

        div.append(actions);
        root.append(div);
      }

      const connText = backendOnline
        ? `Função SheerID ativa (${SHEERID_BACKEND}).`
        : 'Função Netlify offline — publique com Git ou Netlify CLI e defina SUPABASE_URL / SUPABASE_SERVICE_KEY.';
      status(`Conectado ao Supabase. ${jobs.length} pedido(s) carregado(s). ${connText}`, !backendOnline);
    } finally {
      refreshing = false;
    }
  }

  async function bootstrap() {
    const {
      data: { session },
    } = await client.auth.getSession();
    show('login-panel', !session);
    show('main-panel', !!session);
    if (!session) return;
    text('user-display', session.user.email || 'Administrador');
    try {
      await Promise.all([refresh(), refreshPDF()]);
    } catch (e) {
      status(e.message, true);
    }
  }

  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    text('login-status', 'Entrando...');
    const { error } = await client.auth.signInWithPassword({
      email: $('email').value,
      password: $('password').value,
    });
    if (error) {
      text('login-status', error.message);
      return;
    }
    text('login-status', '');
    await bootstrap();
  };

  $('pdf-base-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = $('pdf-base-file').files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024 || f.size < 20) {
      pdfMessage('Tamanho inválido. Limite: 10 MB.', true);
      return;
    }
    if (!/\.pdf$/i.test(f.name)) {
      pdfMessage('Selecione um arquivo .pdf.', true);
      return;
    }
    const signature = new TextDecoder('ascii').decode(await f.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') {
      pdfMessage('O arquivo selecionado não é um PDF válido.', true);
      return;
    }
    if (pdfExists && !confirm('Substituir o PDF-base salvo? O original anterior será removido da biblioteca.')) return;
    $('pdf-base-upload').disabled = true;
    pdfMessage('Salvando PDF original no armazenamento privado...');
    try {
      const { error } = await pdfStore.upload(PDF_PATH, f, {
        upsert: true,
        contentType: 'application/pdf',
        cacheControl: '0',
      });
      if (error) throw new Error(error.message);
      $('pdf-base-file').value = '';
      await refreshPDF();
    } catch (err) {
      pdfMessage('Erro no upload: ' + err.message, true);
    } finally {
      $('pdf-base-upload').disabled = false;
    }
  };

  $('pdf-base-download').onclick = async () => {
    try {
      await downloadPDF();
    } catch (err) {
      pdfMessage('Erro no download: ' + err.message, true);
    }
  };

  $('pdf-base-remove').onclick = async () => {
    if (!confirm('Remover o PDF-base da biblioteca privada?')) return;
    try {
      const { error } = await pdfStore.remove([PDF_PATH]);
      if (error) throw new Error(error.message);
      await refreshPDF();
    } catch (err) {
      pdfMessage('Erro ao remover: ' + err.message, true);
    }
  };

  $('logout').onclick = async () => {
    await client.auth.signOut();
    await bootstrap();
  };

  $('refresh').onclick = () => refresh().catch((e) => status(e.message, true));

  $('run').onclick = async () => {
    if (running) return;
    running = true;
    $('run').disabled = true;
    status('Sincronizando fila com a função SheerID...');
    try {
      await call('run_now');
      const data = await call('list');
      const pendingJobs = (data.jobs || []).filter((j) =>
        ['queued', 'processing', 'awaiting_authorization'].includes(j.status)
      );

      let okCount = 0;
      for (const job of pendingJobs) {
        try {
          await syncSingleJobWithSheerID(job);
          okCount += 1;
        } catch (err) {
          console.error('Falha ao sincronizar job:', job.id, err.message);
        }
      }

      await refresh();
      status(`${okCount} de ${pendingJobs.length} pedido(s) sincronizado(s) com o SheerID.`);
    } catch (e) {
      status(e.message, true);
    } finally {
      running = false;
      $('run').disabled = false;
    }
  };

  setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      !$('main-panel').classList.contains('hidden') &&
      !running
    ) {
      refresh().catch((e) => status(e.message, true));
    }
  }, 10000);

  bootstrap().catch((e) => {
    show('login-panel', true);
    text('login-status', e.message);
  });
})();
