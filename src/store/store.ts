import { configureStore } from "@reduxjs/toolkit";
import { imagesApi } from "./imagesApi";

export const store = configureStore({
  reducer: {
    [imagesApi.reducerPath]: imagesApi.reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(imagesApi.middleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
