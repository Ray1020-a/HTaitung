# 台東住宿地圖

整理台東市、知本、太麻里的住宿資料（`taitung_lodging.json`），以地圖＋列表呈現，支援 RWD。

- 篩選：關鍵字、地區、住宿類型、附設（餐廳／泳池／水療）、最低評分、最少評論數、聯絡方式、只看地圖範圍內
- 排序：推薦（貝氏平均評分）、評分、評論數、名稱
- 地圖：Leaflet + MarkerCluster，底圖皆為免 API key 的公開圖磚（OpenStreetMap、HOT、OpenTopoMap、Esri 衛星）

## 本機預覽

```bash
python -m http.server 8000
# 開啟 http://localhost:8000
```

## 部署

GitHub → Settings → Pages → Source 選 **Deploy from a branch**，Branch 選 `main` / `(root)`。
