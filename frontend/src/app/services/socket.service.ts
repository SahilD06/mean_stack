import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket;

  constructor() {
    const host = window.location.hostname;
    this.socket = io(`https://project-backend-o8xj.onrender.com`);
  }

  emit(event: string, ...args: any[]) {
    console.log(`Socket emitting event: ${event}`, args);
    this.socket.emit(event, ...args);
  }

  on(event: string): Observable<any> {
    return new Observable(observer => {
      this.socket.on(event, (data) => {
        observer.next(data);
      });
    });
  }

  getSocketId() {
    return this.socket.id;
  }
}
