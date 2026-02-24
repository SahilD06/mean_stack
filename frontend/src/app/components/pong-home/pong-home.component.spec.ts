import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PongHomeComponent } from './pong-home.component';

describe('PongHomeComponent', () => {
  let component: PongHomeComponent;
  let fixture: ComponentFixture<PongHomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PongHomeComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PongHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
