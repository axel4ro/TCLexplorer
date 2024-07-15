from django.shortcuts import render

from .models import Time, Date,Resim


# Create your views here.



# Create your views here.



def index(request):

    times = Time.objects.all()  # 'times' adında bir değişken kullanın

    resim = Resim.objects.all()  # 'times' adında bir değişken kullanın


    context = {

        "times": times,  # Doğru değişken adıyla context'e ekleyin

        "resim":resim

    }

    return render(request, 'index.html', context)


def About(request):

    context={}

    return render (request,'about.html', context)


def İtems(request):

    context={}

    return render (request,'items.html',context)



def Kingdoms(request):
    dates = Date.objects.all()  # Tüm Date objelerini veritabanından alın


    context={
        "dates":dates
    }
    
    return render (request,'kingdoms.html',context)


def Bonus(request):


    context={
    }
    
    return render (request,'bonuses.html',context)


    

