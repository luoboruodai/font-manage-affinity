'use strict';

const { Dialog, DialogResult } = require('/dialog.js');
const { Application } = require('/application.js');
const { UnitType } = require('/units.js');
const Core = require('./core.js');
const Host = require('./host.js');
const Storage = require('./storage.js');

const PAGE_SIZE = 5;
const isOK = result => (result?.value ?? result) === DialogResult.Ok.value;

function main() {
  let records;
  try { records = Host.enumerateFonts(); }
  catch (error) { Application.alert(`无法读取 Affinity 字体：${error.message || error}`, 'Font Manage'); return; }
  if (!records.length) { Application.alert('Affinity 未返回可用字体。', 'Font Manage'); return; }
  const loaded = Storage.readState();
  const state = loaded.state;
  const target = Host.captureTarget();
  let current = records.find(font => font.id === state.lastFont) || null;
  let filtered = [], page = 0, groupID = state.groups[0]?.id || '';
  let updating = false, previewActive = false, chosen = false, manageRequested = false;
  let specimenRequested = false, savedJSON = JSON.stringify(state);
  let pendingRecovery = '', writeFailed = false;

  const dlg = Dialog.create('Font Manage');
  dlg.initialWidth = 540;
  dlg.isResizable = true;
  const column = dlg.addColumn();
  const browse = column.addGroup('字体库');
  const scope = browse.addButtonSet('', ['全部', '收藏', '最近', '分组'], 0).setIsFullWidth();
  const query = browse.addTextBox('搜索', '').setDescription('按字体名称、字重或 PostScript 名搜索，多个词用空格分隔。');
  const kind = browse.addComboBox('分类', ['全部字体', '衬线', '无衬线', '等宽'], 0);
  const sort = browse.addComboBox('排序', ['名称 A–Z', '最近使用'], 0);
  const groupInfo = browse.addStaticText('分组', '');

  const resultGroup = column.addGroup('搜索结果');
  const count = resultGroup.addStaticText('', '');
  const rows = Array.from({ length: PAGE_SIZE }, (_, i) => {
    const row = resultGroup.addColumnStack();
    const label = row.addColumn().setWidthProportion(5).addGroup('').addStaticText('', ' ').setIsFullWidth();
    const button = row.addColumn().setWidthProportion(1).addGroup('').addButton(`选择 ${i + 1}`).setIsFullWidth();
    button.onClickHandler = () => guard(() => select(filtered[page * PAGE_SIZE + i]));
    return { label, button };
  });
  const nav = resultGroup.addColumnStack();
  const prev = nav.addColumn().addGroup('').addButton('上一页');
  const next = nav.addColumn().addGroup('').addButton('下一页');
  prev.onClickHandler = () => guard(() => { page--; render(); });
  next.onClickHandler = () => guard(() => { page++; render(); });

  const selected = column.addGroup('所选字体');
  const picker = selected.addFontPicker('字体').setIsFullWidth();
  const details = selected.addStaticText('', '').setIsFullWidth();
  const favorite = selected.addCheckBox('收藏这款字体', false);
  const live = selected.addCheckBox('在画布中预览', false).setIsEnabled(!!target);
  const notice = selected.addStaticText('', target
    ? `已锁定 ${target.count} 个文本对象；点“确定”应用，取消恢复预览。`
    : '先在文档中选择文本对象，再运行脚本即可应用字体。').setIsFullWidth();

  const manageButton = column.addGroup('').addButton('分组、字体对照与数据…').setIsFullWidth();
  const status = column.addGroup('').addStaticText('', loaded.error || `已读取 ${records.length} 款字体`).setIsFullWidth();
  let specimenMode = false;

  function guard(action) {
    if (updating) return;
    try { action(); }
    catch (error) { status.text = `未完成：${error.message || error}`; console.error(error); }
  }
  function persistState() {
    const nextJSON = JSON.stringify(state);
    if (nextJSON === savedJSON) return;
    if (loaded.writable) {
      try {
        Storage.writeState(state);
        savedJSON = nextJSON;
        pendingRecovery = '';
        writeFailed = false;
        return;
      } catch (error) {
        pendingRecovery = `写入失败：${error.message || error}\n数据目录需在脚本设置中获得访问权限。`;
        writeFailed = true;
      }
    } else {
      pendingRecovery = '原数据文件未成功读取，本次操作不会覆盖它。';
    }
    status.text = '数据尚未保存；关闭当前窗口后会显示可复制的 JSON。';
  }
  function showPendingRecovery() {
    if (!pendingRecovery) return;
    const message = pendingRecovery;
    pendingRecovery = '';
    preserveUnsaved(message);
  }
  function clearPreview() {
    if (previewActive) { target.doc.clearPreviews(); previewActive = false; }
  }
  function preview() {
    if (!live.value || !current || !target || specimenMode) { clearPreview(); return; }
    previewActive = true;
    Host.changeFont(target, current, true);
  }
  function render() {
    updating = true;
    try {
      page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)));
      count.text = filtered.length ? `${filtered.length} 款 · 第 ${page + 1} / ${Math.ceil(filtered.length / PAGE_SIZE)} 页` : '没有匹配字体；试试清除搜索或切换范围。';
      rows.forEach((row, i) => {
        const font = filtered[page * PAGE_SIZE + i];
        row.label.text = font ? `${current?.id === font.id ? '● ' : ''}${state.favorites.includes(font.id) ? '★ ' : ''}${font.family} · ${font.style}` : ' ';
        row.button.isEnabled = !!font;
        row.label.description = font?.id || '';
      });
      prev.isEnabled = page > 0;
      next.isEnabled = (page + 1) * PAGE_SIZE < filtered.length;
      details.text = current ? `${current.family} · ${current.style} · ${current.id}` : '选择搜索结果，或使用上方原生字体选择器。';
      favorite.isEnabled = !!current;
      favorite.value = current ? state.favorites.includes(current.id) : false;
      if (current) picker.font = current.native;
      const group = state.groups.find(item => item.id === groupID);
      groupInfo.text = group ? `${group.name} · ${group.fonts.length} 款` : '尚未选择分组';
    } finally { updating = false; }
  }
  function refilter() {
    filtered = Core.filterFonts(records, {
      query: query.text, scope: ['all', 'favorites', 'recent', 'group'][scope.selectedIndex],
      groupID, kind: ['all', 'serif', 'sans', 'mono'][kind.selectedIndex],
      sort: scope.selectedIndex === 2 || sort.selectedIndex ? 'recent' : 'name',
    }, state);
    page = 0;
    render();
  }
  function select(font) {
    if (!font) return;
    current = font;
    chosen = true;
    render();
    preview();
  }
  function pickGroup() {
    if (!state.groups.length) { newGroup(); return; }
    const dialog = Dialog.create('选择分组');
    const choice = dialog.addColumn().addGroup('').addComboBox('分组', state.groups.map(group => group.name), Math.max(0, state.groups.findIndex(group => group.id === groupID)));
    if (isOK(dialog.runModal())) {
      groupID = state.groups[choice.selectedIndex].id;
      updating = true; scope.selectedIndex = 3; updating = false;
      refilter();
    }
  }
  function newGroup() {
    const name = Application.prompt('输入分组名称', 'Font Manage', '');
    if (name == null || !String(name).trim()) return;
    groupID = Core.createGroup(state, name).id;
    render();
  }
  function toggleGroup() {
    if (!current) throw new Error('请先选择字体。');
    if (!groupID) throw new Error('请先新建或选择分组。');
    Core.toggleGroupFont(state, groupID, current.id);
    refilter();
  }
  function renameGroup() {
    const group = state.groups.find(item => item.id === groupID);
    if (!group) throw new Error('请先选择分组。');
    const name = Application.prompt('输入新的分组名称', 'Font Manage', group.name);
    if (name == null || !String(name).trim()) return;
    const trimmed = String(name).trim();
    if (state.groups.some(item => item.id !== groupID && item.name.toLowerCase() === trimmed.toLowerCase())) throw new Error('已有同名分组。');
    group.name = trimmed;
    render();
  }
  function deleteGroup() {
    const group = state.groups.find(item => item.id === groupID);
    if (!group) throw new Error('请先选择分组。');
    if (!Application.confirm(`删除分组“${group.name}”？字体和收藏会保留。`, 'Font Manage')) return;
    state.groups = state.groups.filter(item => item.id !== groupID);
    groupID = state.groups[0]?.id || '';
    refilter();
  }
  function preserveUnsaved(message) {
    const recovery = Dialog.create('Font Manage · 数据尚未保存');
    recovery.initialWidth = 560;
    const group = recovery.addColumn().addGroup('');
    group.addStaticText('', message).setIsFullWidth();
    group.addStaticText('', '可复制下方 JSON 保留收藏与分组，下次通过导入恢复。').setIsFullWidth();
    group.addTextBox('', Core.exportCollections(state)).setIsFullWidth().setIsMultiLine().setRowSpan(7);
    recovery.runModal();
  }
  function collections() {
    const dialog = Dialog.create('导入 / 导出收藏与分组');
    dialog.initialWidth = 540;
    const group = dialog.addColumn().addGroup('');
    group.addStaticText('', '复制下方 JSON 可备份；替换内容后勾选导入，可合并收藏与分组。').setIsFullWidth();
    const text = group.addTextBox('', Core.exportCollections(state)).setIsFullWidth().setIsMultiLine().setRowSpan(7);
    const load = group.addCheckBox('将上方 JSON 合并到当前数据', false);
    if (isOK(dialog.runModal()) && load.value) {
      Core.importCollections(state, text.text);
      if (!groupID) groupID = state.groups[0]?.id || '';
      refilter();
    }
  }

  function runManagement() {
    let action = '';
    const dialog = Dialog.create('Font Manage · 管理');
    dialog.initialWidth = 560;
    const column = dialog.addColumn();
    const groups = column.addGroup('分组');
    const group = state.groups.find(item => item.id === groupID);
    groups.addStaticText('当前分组', group ? `${group.name} · ${group.fonts.length} 款` : '尚未选择分组');
    const managerStatus = column.addGroup('').addStaticText('', '选择一项操作后点“确定”执行；取消返回字体列表。').setIsFullWidth();
    function choose(name, value) {
      action = value;
      managerStatus.text = `已选择${name}，点“确定”继续。`;
    }
    groups.addButton('选择分组…').onClickHandler = () => choose('选择分组', 'pickGroup');
    groups.addButton('新建分组…').onClickHandler = () => choose('新建分组', 'newGroup');
    groups.addButton('加入 / 移出分组').onClickHandler = () => choose('调整分组', 'toggleGroup');
    groups.addButton('重命名分组…').onClickHandler = () => choose('重命名分组', 'renameGroup');
    groups.addButton('删除当前分组…').onClickHandler = () => choose('删除分组', 'deleteGroup');

    const compare = column.addGroup('字体对照');
    const sample = compare.addTextBox('对照文字', state.previewText);
    const size = compare.addUnitValueEditor('对照字号', UnitType.Number, UnitType.Number, state.previewSize, 12, 64).setPrecision(0);
    const specimen = compare.addCheckBox('确定后新建本页字体对照文档', specimenMode);
    specimen.setDescription('生成当前页最多五种字体的可编辑样张；此模式不会更改原文档字体。');

    const data = column.addGroup('收藏与数据');
    data.addButton('导入 / 导出收藏与分组…').onClickHandler = () => choose('导入 / 导出', 'collections');
    data.addStaticText('数据文件', Storage.DATA_PATH).setIsFullWidth();
    if (!isOK(dialog.runModal())) return '';
    state.previewText = sample.text;
    state.previewSize = size.value;
    specimenMode = specimen.value;
    persistState();
    return action;
  }

  [query, scope, kind, sort].forEach(control => control.onValueChangedHandler = () => guard(refilter));
  picker.onValueChangedHandler = () => guard(() => {
    const id = picker.font?.postscriptName;
    const font = records.find(record => record.id === id);
    if (font) select(font);
    else status.text = '此字体未在 Affinity 可用字体列表中。';
  });
  favorite.onValueChangedHandler = () => guard(() => { if (current) { Core.toggleFavorite(state, current.id); refilter(); persistState(); } });
  live.onValueChangedHandler = () => guard(preview);
  manageButton.onClickHandler = () => guard(() => {
    manageRequested = true;
    status.text = '已选择管理；请点“确定”打开管理窗口。';
  });
  refilter();

  let applied = false;
  try {
    while (true) {
      const result = dlg.runModal();
      clearPreview();
      showPendingRecovery();
      if (!isOK(result)) break;
      if (manageRequested) {
        manageRequested = false;
        while (true) {
          const action = runManagement();
          showPendingRecovery();
          if (!action) break;
          try {
            if (action === 'pickGroup') pickGroup();
            else if (action === 'newGroup') newGroup();
            else if (action === 'toggleGroup') toggleGroup();
            else if (action === 'renameGroup') renameGroup();
            else if (action === 'deleteGroup') deleteGroup();
            else if (action === 'collections') collections();
          } catch (error) { Application.alert(error.message || String(error), 'Font Manage'); }
          persistState();
          showPendingRecovery();
        }
        notice.text = specimenMode ? '确定后创建独立字体对照文档；原文档保持不变。' :
          (target ? '点“确定”应用，取消恢复画布预览。' : '当前未选择文本对象，仅管理字体。');
        if (JSON.stringify(state) === savedJSON) {
          status.text = loaded.error || (specimenMode ?
            '已返回字体列表；字体对照模式已开启。' : `已返回字体列表 · ${records.length} 款字体`);
        }
        preview();
        continue;
      }
      try {
        if (specimenMode && !filtered.length) throw new Error('当前页没有字体，请修改筛选。');
        if (!specimenMode && target && !chosen) throw new Error('请先选择要应用的字体。');
        if (specimenMode) specimenRequested = true;
        else if (target && current) {
          Host.changeFont(target, current, false);
          Core.rememberFont(state, current.id);
          applied = true;
        }
        break;
      } catch (error) {
        Application.alert(error.message || String(error), 'Font Manage');
        preview();
      }
    }
  } finally {
    clearPreview();
    if (loaded.writable && !writeFailed && JSON.stringify(state) !== savedJSON) {
      try { Storage.writeState(state); }
      catch (error) { pendingRecovery = `写入失败：${error.message || error}`; }
    }
  }
  showPendingRecovery();
  if (specimenRequested) Host.makeSpecimen(filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), state.previewText, state.previewSize);
  console.log(`Font Manage: ${records.length} fonts; applied=${applied}; specimen=${specimenRequested}`);
}

module.exports.main = main;
