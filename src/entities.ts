import { at, covered, expand, fail, pointer, safeKey, segments, write } from './json.js';
import type { CompiledDefinition, EntityEntry, EntitySpec, LogicalState, RefEntry } from './types.js';

export class EntityGraph {
  private byPointer = new Map<string, EntityEntry>();
  readonly entities = new Map<string, EntityEntry>();
  readonly refs: RefEntry[] = [];
  constructor(public readonly definition: CompiledDefinition, public readonly state: LogicalState) {
    for (const spec of definition.entities ?? []) {
      const locations = expand(state.data, spec.path);
      if (spec.singletonId && !spec.nullable && !locations.length) fail('REQUIRED_ENTITY', `缺少必需单例：${spec.singletonId}`);
      for (const found of locations) {
        if (spec.singletonId) {
          if (found.value === null && spec.nullable) continue;
          this.add(spec.singletonId, found.parts, found.value, spec);
        } else {
          if (!found.value || typeof found.value !== 'object' || Array.isArray(found.value)) fail('ENTITY_CONTAINER', '实体集合必须是 Record', pointer(found.parts));
          for (const [key, value] of Object.entries(found.value)) this.add(key, [...found.parts, key], value, spec);
        }
      }
    }
    for (const entity of this.entities.values()) {
      let ancestor = entity.pointer.slice(0, entity.pointer.lastIndexOf('/'));
      while (ancestor) {
        const owner = this.byPointer.get(ancestor);
        if (owner) { entity.owner = owner.id; break; }
        ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
      }
    }
    for (const spec of definition.refs ?? []) for (const found of expand(state.data, spec.path)) {
      if (spec.kind === 'single') {
        if (found.value !== null) this.addRef(found.value, found.parts, spec);
      } else if (spec.kind === 'array') {
        if (!Array.isArray(found.value)) fail('REF_TYPE', '数组引用字段必须为数组');
        const ids = new Set<string>();
        found.value.forEach((value, i) => {
          const target = this.refId(value);
          if (ids.has(target)) fail('DUPLICATE_REFERENCE', '引用数组有重复目标');
          ids.add(target); this.addRef(value, [...found.parts, String(i)], spec);
        });
      } else {
        if (!found.value || Array.isArray(found.value) || typeof found.value !== 'object') fail('REF_TYPE', '字典引用必须为对象');
        for (const key of Object.keys(found.value)) this.addRef(key, [...found.parts, key], spec);
      }
    }
  }
  private add(id: string, parts: string[], value: unknown, spec: EntitySpec): void {
    safeKey(id);
    if (!id || /[.@]/u.test(id)) fail('INVALID_ENTITY_ID', '实体 ID 不含点号或 @');
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ENTITY_TYPE', '实体必须是对象', pointer(parts));
    if (this.entities.has(id)) fail('DUPLICATE_ENTITY_ID', `实体 ID 重复：${id}`);
    const entry = { id, pointer: pointer(parts), type: spec.type };
    this.entities.set(id, entry); this.byPointer.set(entry.pointer, entry);
  }
  private refId(value: unknown): string {
    if (typeof value !== 'string' || !value) fail('REF_TYPE', '引用必须是实体 ID 字符串');
    return value.startsWith('@') ? value.slice(1) : value;
  }
  private addRef(value: unknown, parts: string[], spec: RefEntry['spec']): void {
    const target = this.refId(value);
    if (!this.entities.has(target)) fail('DANGLING_REFERENCE', `引用目标不存在：${target}`, pointer(parts));
    this.refs.push({ pointer: pointer(parts), target, spec });
  }
  container(parts: string[]): EntitySpec | undefined {
    return this.definition.entities?.find(s => !s.singletonId && covered(s.path, parts) && s.path.split('.').length === parts.length);
  }
  entityAt(parts: string[]): EntityEntry | undefined { return this.byPointer.get(pointer(parts)); }
  resolve(path: string, aliases: Record<string, string> = {}): string[] {
    if (typeof path !== 'string' || !path) fail('INVALID_PATH', '路径必须是非空字符串');
    if (path.startsWith('/')) return segments(path);
    const parts = path.split('.');
    if (parts.some(p => !p)) fail('INVALID_PATH', '路径不能有空片段', path);
    if (parts[0]!.startsWith('@')) {
      const id = parts[0]!.slice(1);
      if (aliases[id] && aliases[id] !== id) fail('AMBIGUOUS_ALIAS', `ID ${id} 已重命名为 ${aliases[id]}；请使用实际 ID`, path);
      const entity = this.entities.get(id);
      if (!entity) fail('ENTITY_NOT_FOUND', `实体不存在：${id}`, path);
      return [...segments(entity.pointer), ...parts.slice(1).map(k => { safeKey(k); return k; })];
    }
    if (parts[0] === '$self') fail('SELF_UNBOUND', '$self 只能由绑定上下文的调用方展开');
    return parts.map(k => { safeKey(k); return k; });
  }
  delete(id: string): void {
    this.deleteMany([id]);
  }
  deleteMany(requestedIds: string[]): void {
    const roots = requestedIds.map(id => {
      const entity = this.entities.get(id);
      if (!entity) fail('ENTITY_NOT_FOUND', `实体不存在：${id}`);
      const spec = this.definition.entities?.find(s => s.singletonId === id);
      if (spec && !spec.nullable) fail('REQUIRED_ENTITY', '不可删除必需单例');
      return entity;
    });
    const inside = (path: string): boolean => roots.some(e => path === e.pointer || path.startsWith(e.pointer + '/'));
    const victims = [...this.entities.values()].filter(e => inside(e.pointer));
    const ids = new Set(victims.map(e => e.id));
    const external = this.refs.filter(r => ids.has(r.target) && !inside(r.pointer));
    if (external.some(r => r.spec.onDelete === 'restrict')) fail('DELETE_RESTRICTED', '外部引用禁止删除');
    // Descending numeric indices prevent array-remove shifts.
    external.sort((a, b) => {
      const x = segments(a.pointer), y = segments(b.pointer);
      if (pointer(x.slice(0, -1)) === pointer(y.slice(0, -1)) && /^\d+$/u.test(x.at(-1)!) && /^\d+$/u.test(y.at(-1)!)) return Number(y.at(-1)) - Number(x.at(-1));
      return b.pointer.length - a.pointer.length || b.pointer.localeCompare(a.pointer);
    });
    for (const ref of external) write(this.state.data, segments(ref.pointer), null, ref.spec.onDelete !== 'null');
    for (const root of roots) {
      const nullable = this.definition.entities?.find(s => s.singletonId === root.id)?.nullable;
      write(this.state.data, segments(root.pointer), null, !nullable);
    }
    for (const victim of victims) if (Object.hasOwn(this.state.engineState.prefabLifecycle, victim.id)) this.state.engineState.prefabLifecycle[victim.id] = 'destroyed';
  }
}
