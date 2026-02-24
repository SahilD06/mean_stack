# Deploying to Render (Separate Services)

Follow these steps to host your Backend and Frontend separately:

## 1. Backend (Web Service)
1.  **New +** -> **Web Service**
2.  **Root Directory**: `backend`
3.  **Build Command**: `npm install`
4.  **Start Command**: `npm start`
5.  **Environment Variables**:
    - `MONGO_URI`: `mongodb+srv://sahiltheboss6_db_user:kr6qTvhNCOOekBfQ@game.wcxfbdq.mongodb.net/?appName=Game`

## 2. Frontend (Static Site)
1.  **New +** -> **Static Site**
2.  **Root Directory**: `frontend`
3.  **Build Command**: `npm install && npm run build`
4.  **Publish Directory**: `dist/frontend`
5.  **Rewrite Rules**:
    - Under the **Redirects/Rewrites** tab, add a rule:
        - **Source**: `/*`
        - **Destination**: `/index.html`
        - **Action**: `Rewrite`

## 3. Link them up
Make sure your `frontend/src/environments/environment.prod.ts` has the correct `socketUrl` pointing to your Backend URL.
