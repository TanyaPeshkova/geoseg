import type { ModelDef } from '../types'

export const MODELS: ModelDef[] = [
  { key:'lulc',     label:'Общая сегментация', file:'lulc_checkpoint_1.pth',        color:'#00e5a0', iou:'IoU 0.43', alwaysOn:false },
  { key:'water',    label:'Водоёмы',           file:'water_bodies_checkpoint.pth',   color:'#3b9eff', iou:'IoU 0.81', alwaysOn:false },
  { key:'forest',   label:'Леса',              file:'forest_seg_checkpoint.pth',     color:'#22c55e', iou:'IoU 0.82', alwaysOn:false },
  { key:'building', label:'Здания',            file:'building_seg_checkpoint.pth',   color:'#ef4444', iou:'IoU 0.78', alwaysOn:false },
  { key:'road',     label:'Дороги',            file:'road_seg_checkpoint.pth',       color:'#f59e0b', iou:'IoU 0.74', alwaysOn:false },
  { key:'terrain',  label:'Тип рельефа',       file:'terrain_checkpoint.pth',        color:'#a78bfa', iou:'Acc 0.91', alwaysOn:true  },
]

export const CLASS_COLOR: Record<string, string> = {
  water:      '#3b9eff',
  forest:     '#22c55e',
  building:   '#ef4444',
  road:       '#f59e0b',
  agriculture:'#86efac',
  rangeland:  '#a3e635',
  barren:     '#d97706',
}

export const CLASS_LABEL: Record<string, string> = {
  water:'Вода', forest:'Лес', building:'Здания',
  road:'Дороги', agriculture:'С/х угодья',
  rangeland:'Кустарник', barren:'Пустошь',
}
