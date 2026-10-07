const $ = (selector, root = document) => root.querySelector(selector);

async function send(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || 'Could not complete that action.');
  return result;
}

document.querySelectorAll('[data-api-form]').forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type=submit]');
  const feedback = $('.form-error', form);
  if (button) button.disabled = true;
  feedback.textContent = '';
  try {
    const result = await send(form.dataset.path, Object.fromEntries(new FormData(form)));
    if (form.dataset.path === 'admin/users') {
      $('#admin-code-value').textContent = result.recoveryCode;
      $('#admin-recovery-code').showModal();
      form.reset();
    } else location.reload();
  } catch (error) { feedback.textContent = error.message; }
  finally { if (button) button.disabled = false; }
}));

document.querySelectorAll('[data-admin-action]').forEach(button => button.addEventListener('click', async () => {
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  const row = button.closest('[data-admin-row]'), feedback = $('.admin-row-feedback', row);
  button.disabled = true;
  feedback.textContent = '';
  try {
    await send(button.dataset.path, JSON.parse(button.dataset.body));
    location.reload();
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
}));

$('#admin-recovery-code')?.addEventListener('close', () => { $('#admin-code-value').textContent = ''; });
$('[data-copy-code]')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#admin-code-value').textContent); }
  catch { window.prompt('Copy this recovery code:', $('#admin-code-value').textContent); }
});
$('[data-close-code]')?.addEventListener('click', () => { $('#admin-recovery-code').close(); location.reload(); });