from django.db import models

# Create your models here.
class Time(models.Model):
    text = models.TextField()
    date_now = models.DateField()

    
# KİNGDOM MAPS CARD OBJECT

class Date(models.Model):
    title = models.CharField(max_length=200, verbose_name="title")
    text = models.TextField(max_length=2000,verbose_name="kingdomDetailText")
    image = models.ImageField(upload_to='media/', max_length=100 , blank=True, verbose_name="İmage")
    date_now = models.DateField()
    
    # create new object name for admin panel
    def __str__(self):
        return self.title
    
    # test for index html
class Resim(models.Model):
    gorsel=models.FileField(upload_to='media/',max_length=100, blank=True)



class İtem(models.Model):
    image=models.ImageField("media/", max_length=None,blank=True)
