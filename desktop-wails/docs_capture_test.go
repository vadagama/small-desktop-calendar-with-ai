//go:build docs_capture && darwin

package main

import (
	"os"
	"path/filepath"
)

func init() {
	directory := os.Getenv("SMALL_WAILS_DOCS_DIR")
	if directory == "" {
		return
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		panic(err)
	}
	profile, err := os.MkdirTemp("", "ordo-docs-clean-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(profile)
	absolute, err := filepath.Abs(directory)
	if err != nil {
		panic(err)
	}
	startDocsCapture(absolute)
	runPreview(profile, "https://team.small.kz", docsCaptureScript)
	_ = os.RemoveAll(profile)
	os.Exit(0)
}

const docsCaptureScript = `
(async () => {
 const wait = async (test) => { for(let i=0;i<80;i++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('capture readiness timeout'); };
 const button = (name) => document.querySelector('button[aria-label="'+name+'"]');
 const snap = async name => {window.__ordoCaptureName=name;await wait(()=>window.__ordoCaptureDone===name);window.__ordoCaptureName='';};
 try {
  await wait(()=>window.smallDesktop && document.querySelector('.ordo-emblem')?.naturalWidth>0);
  await wait(()=>button('Войти в Small — открыть форму'));
  button('Войти в Small — открыть форму').click();
  await wait(()=>document.querySelector('#small-account-password'));
  if(document.querySelector('#small-account-password').value || document.querySelector('[name="username"]').value)throw Error('nonempty login');
  await snap('ordo-login');
  button('Закрыть профиль Small').click();
  button('Настройки модели').click();
  await wait(()=>document.querySelector('dialog[aria-label="Настройки модели"]'));
  await snap('ordo-model');
  [...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='Voice').click();
  await wait(()=>document.body.textContent.includes('Модель не установлена'));
  await snap('ordo-voice');
  await fetch('/__preview_ready');
 } catch(e){await fetch('/__preview_ready?pending='+encodeURIComponent(String(e)));}
})();`
