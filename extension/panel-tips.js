// Render bundled authored tip bodies by stable ID and redraw the current tip without rotating or updating seen history.
(() => {
  /** Bind the existing tip action to locale redraw while preserving worker selection and evidence. */
  window.__jobadabraPanelTips = ({send,host,prefer,text,box,label}) => {
    let current=null;
    const draw=()=>{if(!current)return;label(current.evidence);text.textContent=window.__jobadabraPanelI18n.t('tip.'+current.id,current.text);box.hidden=false;};
    window.__jobadabraPanelI18n.onChange(draw);
    return async()=>{const answer=await send({type: 'panelTip',host,prefer:prefer()}).catch(()=>null);if(!answer?.ok)return;current=answer;draw();};
  };
})();
